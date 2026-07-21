# measures failover time. every second it logs how many Route 53 health
# checkers still see each cloud as healthy, and samples the weighted DNS
# answer to see when the dead cloud stops being returned.
# kill/restore in another window:
#   az functionapp stop  -g eventapp-rg -n eventapp-func-zhw36q
#   az functionapp start -g eventapp-rg -n eventapp-func-zhw36q

$record       = "api.cn6000-jin-fyp.com"
$nameserver   = "ns-40.awsdns-05.com"
$awsHcId      = "6142cb72-7434-4ec1-a3ec-ee7586be0854"
$azureHcId    = "543e7418-aa50-468c-a999-f0080630d8b1"
$runId        = Get-Date -Format "MMddHHmmss"   # unique tag so each run gets its own log
$logfile      = "rto-log-$runId.csv"

$awsTarget    = "l30myjhqlk"
$azureTarget  = "eventapp-func-zhw36q"
$dnsSamples   = 10   # DNS lookups per second to estimate the weighted split

"timestamp,aws_healthy_checkers,azure_healthy_checkers,aws_dns_share,azure_dns_share" |
    Out-File $logfile -Encoding utf8

Write-Host "Watching health checks + weighted DNS every 1s. Ctrl+C to stop."
Write-Host "Logging to $logfile"
Write-Host "Kill Azure in another window (the log timestamps capture it).`n"

function Count-Healthy($hcId) {
    # count how many regional checkers currently report Success
    $statuses = aws route53 get-health-check-status --health-check-id $hcId `
        --query "HealthCheckObservations[].StatusReport.Status" --output text 2>$null
    if (-not $statuses) { return 0 }
    # --output text returns tab/newline separated; count "Success" hits
    return ([regex]::Matches($statuses, "Success")).Count
}

while ($true) {
    $ts = Get-Date -Format "HH:mm:ss"

    $awsHealthy   = Count-Healthy $awsHcId
    $azureHealthy = Count-Healthy $azureHcId

    # sample the weighted answer a handful of times
    $awsHits = 0; $azureHits = 0
    for ($i = 0; $i -lt $dnsSamples; $i++) {
        $out = nslookup -type=CNAME $record $nameserver 2>&1 | Out-String
        if ($out -match $awsTarget)   { $awsHits++ }
        if ($out -match $azureTarget) { $azureHits++ }
    }

    "$ts,$awsHealthy,$azureHealthy,$awsHits,$azureHits" | Out-File $logfile -Append -Encoding utf8
    Write-Host "$ts  health[aws=$awsHealthy azure=$azureHealthy]  dns/{$dnsSamples}[aws=$awsHits azure=$azureHits]"

    Start-Sleep -Seconds 1
}

# registers a user every second against ONE cloud while the OTHER is down.
# each email has a sequence number so afterwards we can check which ones
# the down cloud missed. using register because it needs no auth token and
# still goes through the normal dual-write path.
# run this, kill the other cloud partway (see measure-rto.ps1), let it run
# through the outage, bring the cloud back, then run verify-rpo.ps1.

# point this at whichever cloud stays UP
# $apiBase = "https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"  # AWS up
$apiBase = "https://eventapp-func-zhw36q.azurewebsites.net/api"         # Azure up
# the Azure base already has /api so the path below stays the same either way

$runId   = Get-Date -Format "MMddHHmmss"   # unique tag so reruns don't collide
$logfile = "rpo-log-$runId.csv"
"seq,timestamp,status,email" | Out-File $logfile -Encoding utf8
Write-Host "Logging to $logfile"
Write-Host "Run tag (for verify step): $runId"

Write-Host "Registering users against $apiBase every 1s. Ctrl+C to stop."
Write-Host "Kill the OTHER cloud partway through.`n"

$seq = 0
while ($true) {
    $seq++
    $seqStr = "{0:D4}" -f $seq
    $email  = "rpo-$runId-$seqStr@test.local"
    $ts     = Get-Date -Format "HH:mm:ss.fff"

    $bodyObj = @{
        name             = "RPO Test $seqStr"
        email            = $email
        password         = "TestPass123!"
        securityQuestion = "test question"
        securityAnswer   = "test answer"
    }
    $body = $bodyObj | ConvertTo-Json

    try {
        $r = Invoke-WebRequest -Uri "$apiBase/users/register" -Method POST `
             -Body $body -ContentType "application/json" `
             -UseBasicParsing -TimeoutSec 15
        $status = $r.StatusCode
    } catch {
        # capture http status if there is one, else the error text
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        } else {
            $status = "ERR"
        }
    }

    "$seqStr,$ts,$status,$email" | Out-File $logfile -Append -Encoding utf8
    Write-Host "$ts  seq=$seqStr  status=$status"
    Start-Sleep -Seconds 1
}

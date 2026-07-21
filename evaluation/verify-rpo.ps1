# checks each test user against both clouds by trying to log in
# (200 = user exists there, 401 = doesn't). a user that works on AWS but
# 401s on Azure is one that never replicated = the RPO loss. no DB access
# needed, just the login endpoint.
# usage: .\verify-rpo.ps1 -RunId 0717161050 -LastSeq 96
param(
    [Parameter(Mandatory=$true)] [string]$RunId,
    [Parameter(Mandatory=$true)] [int]$LastSeq,
    [int]$FirstSeq = 1
)

$awsBase   = "https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
$azureBase = "https://eventapp-func-zhw36q.azurewebsites.net/api"

$runId    = $RunId
$firstSeq = $FirstSeq
$lastSeq  = $LastSeq
$password = "TestPass123!"

$logfile = "rpo-verify-$runId.csv"
"seq,email,aws_status,azure_status,note" | Out-File $logfile -Encoding utf8

function Try-Login($base, $email, $password) {
    $body = @{ email = $email; password = $password } | ConvertTo-Json
    try {
        $r = Invoke-WebRequest -Uri "$base/users/login" -Method POST `
             -Body $body -ContentType "application/json" `
             -UseBasicParsing -TimeoutSec 10
        return [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return -1   # network/other error
    }
}

$awsHas = 0; $azureHas = 0; $lostOnAzure = 0

for ($s = $firstSeq; $s -le $lastSeq; $s++) {
    $seqStr = "{0:D4}" -f $s
    $email  = "rpo-$runId-$seqStr@test.local"

    $aws   = Try-Login $awsBase   $email $password
    $azure = Try-Login $azureBase $email $password

    if ($aws   -eq 200) { $awsHas++ }
    if ($azure -eq 200) { $azureHas++ }

    $note = ""
    if ($aws -eq 200 -and $azure -ne 200) { $lostOnAzure++; $note = "MISSING_ON_AZURE" }

    "$seqStr,$email,$aws,$azure,$note" | Out-File $logfile -Append -Encoding utf8
    Write-Host "$seqStr  aws=$aws  azure=$azure  $note"
}

Write-Host ""
Write-Host "=== SUMMARY ==="
Write-Host "checked seq $firstSeq..$lastSeq"
Write-Host "present on AWS   : $awsHas"
Write-Host "present on Azure : $azureHas"
Write-Host "on AWS but NOT on Azure (RPO loss): $lostOnAzure"

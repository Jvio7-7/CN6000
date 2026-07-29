# measures RPO both directions in one go. for each direction it registers
# users against the surviving cloud, kills the other one partway, brings it
# back, and records who didn't replicate.
#
# two numbers per direction:
#   raw  = loss right after restore, before auto-reconcile kicks in (~90s away)
#   post = loss after a manual reconcile - should drop to 0
# story: "the outage lost N users, reconcile brought it back to 0".
#
# writes three files per run:
#   rpo-<id>.csv            summary (one row per direction, with event times)
#   rpo-<id>-register.csv   every register attempt (seq, time, status, phase)
#   rpo-<id>-verify.csv     every user checked on both clouds (raw + post)
#
# aws kill = disable the replicate-receiver lambdas (matches Azure functionapp
# stop - both cut the replication path). login stays up so we can always check.

$awsBase = "https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
$azBase  = "https://eventapp-func-zhw36q.azurewebsites.net"   # no /api prefix
$azFunc  = "eventapp-func-zhw36q"
$azRg    = "eventapp-rg"
$awsRegion = "ap-southeast-1"
$awsReplFuncs = @("event-app-replicate-users","event-app-replicate-events","event-app-replicate-bookings","event-app-replicate-payments")

$preKillSec = 20
$outageSec  = 60
$settleSec  = 25

$runId  = Get-Date -Format "MMddHHmmss"
$sumCsv = "rpo-$runId.csv"
$regCsv = "rpo-$runId-register.csv"
$verCsv = "rpo-$runId-verify.csv"
"scenario,surviving,down,first_seq,last_seq,raw_loss,post_loss,kill_time,restore_time,reconcile_time" | Out-File $sumCsv -Encoding utf8
"scenario,target_cloud,seq,email,register_time,status,phase" | Out-File $regCsv -Encoding utf8
"scenario,seq,email,check_stage,on_survivor,on_down,lost" | Out-File $verCsv -Encoding utf8

$tfvars  = "D:\Final_Project\event-app\terraform\aws\terraform.tfvars"
$replKey = (Select-String -Path $tfvars -Pattern 'replication_secret\s*=\s*"([^"]+)"').Matches.Groups[1].Value
if (-not $replKey) { Write-Host "couldn't read replication_secret from tfvars" -ForegroundColor Red; exit 1 }

function Now { (Get-Date).ToString("HH:mm:ss.fff") }

function Register($base, $seq, $tag) {
    $email = "rpo-$tag-{0:D4}@test.local" -f $seq
    $body  = @{ name="RPO $seq"; email=$email; password="TestPass123!"; securityQuestion="test question"; securityAnswer="testanswer" } | ConvertTo-Json
    try { $r = Invoke-WebRequest -Uri "$base/users/register" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 15; return [int]$r.StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

function Exists($base, $seq, $tag) {
    $email = "rpo-$tag-{0:D4}@test.local" -f $seq
    $body  = @{ email=$email; password="TestPass123!" } | ConvertTo-Json
    try { return ((Invoke-WebRequest -Uri "$base/users/login" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) }
    catch { return $false }
}

# check every user on both clouds, log each one, return the loss count
function CheckAll($scenario, $surv, $down, $first, $last, $tag, $stage) {
    $n = 0
    for ($s = $first; $s -le $last; $s++) {
        $onSurv = Exists $surv $s $tag
        $onDown = Exists $down $s $tag
        $lost = ($onSurv -and -not $onDown)
        if ($lost) { $n++ }
        $email = "rpo-$tag-{0:D4}@test.local" -f $s
        "$scenario,$s,$email,$stage,$onSurv,$onDown,$lost" | Out-File $verCsv -Append -Encoding utf8
    }
    return $n
}

function HealthOk($base) {
    try { return ((Invoke-WebRequest -Uri "$base/health" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) } catch { return $false }
}

function Run($downCloud) {
    if ($downCloud -eq "azure") { $surv=$awsBase; $down=$azBase; $sName="aws"; $dName="azure" }
    else { $surv=$azBase; $down=$awsBase; $sName="azure"; $dName="aws" }
    $tag = "$runId$sName"
    $scen = "$downCloud-down"
    Write-Host ""
    Write-Host "=== $downCloud down (survivor: $sName) ===" -ForegroundColor Cyan

    $seq = 0; $first = 1
    Write-Host "  registering vs $sName for ${preKillSec}s..." -ForegroundColor DarkGray
    $t = Get-Date
    while (((Get-Date)-$t).TotalSeconds -lt $preKillSec) {
        $seq++; $rt = Now; $st = Register $surv $seq $tag
        "$scen,$sName,$seq,rpo-$tag-$('{0:D4}' -f $seq)@test.local,$rt,$st,pre-kill" | Out-File $regCsv -Append -Encoding utf8
        Start-Sleep -Seconds 1
    }

    $killTime = Now
    Write-Host "  $killTime kill $downCloud" -ForegroundColor Red
    if ($downCloud -eq "azure") { az functionapp stop -n $azFunc -g $azRg 2>$null | Out-Null }
    else { foreach ($f in $awsReplFuncs) { aws lambda put-function-concurrency --region $awsRegion --function-name $f --reserved-concurrent-executions 0 2>$null | Out-Null } }

    $t = Get-Date
    while (((Get-Date)-$t).TotalSeconds -lt $outageSec) {
        $seq++; $rt = Now; $st = Register $surv $seq $tag
        "$scen,$sName,$seq,rpo-$tag-$('{0:D4}' -f $seq)@test.local,$rt,$st,outage" | Out-File $regCsv -Append -Encoding utf8
        Start-Sleep -Seconds 1
    }
    $last = $seq

    $restoreTime = Now
    Write-Host "  $restoreTime restore $downCloud" -ForegroundColor DarkYellow
    if ($downCloud -eq "azure") { az functionapp start -n $azFunc -g $azRg 2>$null | Out-Null }
    else { foreach ($f in $awsReplFuncs) { aws lambda delete-function-concurrency --region $awsRegion --function-name $f 2>$null | Out-Null } }

    # RAW loss - checked immediately, before auto-reconcile fires. logs each user.
    Write-Host "  counting raw loss (before auto-reconcile)..." -ForegroundColor DarkGray
    $raw = CheckAll $scen $surv $down $first $last $tag "raw"
    Write-Host "  RAW loss: $raw / $($last-$first+1)" -ForegroundColor Yellow

    # manual reconcile from survivor, then re-check every user
    $recTime = Now
    Write-Host "  $recTime manual reconcile from $sName..." -ForegroundColor DarkGray
    try { curl.exe -s -X POST "$surv/replicate/reconcile" -H "x-replication-key: $replKey" | Out-Null } catch {}
    Start-Sleep -Seconds $settleSec
    $post = CheckAll $scen $surv $down $first $last $tag "post"
    Write-Host "  POST-reconcile loss: $post" -ForegroundColor Green

    "$scen,$sName,$downCloud,$first,$last,$raw,$post,$killTime,$restoreTime,$recTime" | Out-File $sumCsv -Append -Encoding utf8

    Write-Host "  waiting for $dName /health before next scenario..." -ForegroundColor DarkGray
    $t = Get-Date; while (((Get-Date)-$t).TotalSeconds -lt 180) { if (HealthOk $down) { break }; Start-Sleep -Seconds 3 }
    Start-Sleep -Seconds 20
}

Write-Host "rpo run -> $sumCsv (+register/verify logs)   outage ${outageSec}s"

$pfA = Register $awsBase 9001 "preflight$runId"
$pfB = Register $azBase  9002 "preflight$runId"
Write-Host "preflight register  aws=$pfA  azure=$pfB  (expect 200/201)"
if ($pfA -notin 200,201 -or $pfB -notin 200,201) {
    Write-Host "registration isn't succeeding - fix before measuring. aborting." -ForegroundColor Red
    exit 1
}

Run "azure"   # aws survives
Run "aws"     # azure survives

Write-Host ""
Write-Host "done. files:" -ForegroundColor Green
Write-Host "  summary : $sumCsv"
Write-Host "  register: $regCsv"
Write-Host "  verify  : $verCsv"
Import-Csv $sumCsv | Format-Table -AutoSize

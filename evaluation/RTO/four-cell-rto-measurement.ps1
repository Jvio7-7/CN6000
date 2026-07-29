# measures failover time across the two DNS control planes at once.
# same idea as measure-rto.ps1 but crosses two kill directions with two
# resolvers, so one AWS kill gives cells 1+3 and one Azure kill gives 2+4:
#
#            | aws kill | azure kill
#   ---------+----------+-----------
#   route53  |  cell 1  |  cell 2
#   tm       |  cell 3  |  cell 4
#
# route53 plane: query api.gather-up.info straight at a Route 53 NS.
# tm plane: query the traffic manager name at its own authoritative servers
#   (tm*.dns-tm.com) so there's no recursive-resolver cache in the way -
#   this matches how the route53 plane hits ns-92 directly, so both planes
#   are observed the same way.
#
# aws kill  = throttle the health lambda to 0 (same as the rpo runs)
# azure kill = az functionapp stop
# don't ctrl+c mid-run or a cloud can stay killed - it auto-restores and
# waits for /health 200 before the next trial.
#
# records two times per cell:
#   rto_seconds      = failover  (kill -> killed cloud drops out of DNS = downtime)
#   failback_seconds = recovery  (restore -> killed cloud reappears in DNS = back to full active/active)

$r53ns    = "ns-92.awsdns-11.com"
$apiName  = "api.gather-up.info"
$tmName   = "gather-api-tm.trafficmanager.net"
$tmResolver = "tm1.dns-tm.com"   # traffic manager's authoritative server (no recursive cache)

$awsMark  = "execute-api"      # aws endpoint shows up as *.execute-api.*
$azMark   = "azurewebsites"    # azure endpoint as *.azurewebsites.net

$awsFunc  = "event-app-health"
$awsRegion = "ap-southeast-1"
$azFunc   = "eventapp-func-zhw36q"
$azRg     = "eventapp-rg"

$awsHealthUrl = "https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com/health"
$azHealthUrl  = "https://eventapp-func-zhw36q.azurewebsites.net/health"

$trials       = 10
$samples      = 5    # queries per sample (weighted answer returns 1 target each)
$confirm      = 2    # samples in a row before we trust a state change
$pollSec      = 2
$maxDetectSec = 240
$baseMaxSec   = 180
$recoverMaxSec= 420   # failback (health re-detect + DNS re-include) can run longer than a plain health check
$cooldownSec  = 20
$runId        = Get-Date -Format "MMddHHmmss"   # unique tag per run so results don't overwrite
$outCsv       = "four-cell-rto-$runId.csv"

# --- kill / restore ---
function Kill-Aws     { aws lambda put-function-concurrency --region $awsRegion --function-name $awsFunc --reserved-concurrent-executions 0 2>$null | Out-Null }
function Restore-Aws  { aws lambda delete-function-concurrency --region $awsRegion --function-name $awsFunc 2>$null | Out-Null }
function Kill-Azure   { az functionapp stop  -n $azFunc -g $azRg 2>$null | Out-Null }
function Restore-Azure{ az functionapp start -n $azFunc -g $azRg 2>$null | Out-Null }

# resolve a name once, return the answer text (cnames + hosts joined)
function Lookup($name, $server) {
    try {
        $r = Resolve-DnsName -Name $name -Server $server -Type CNAME -DnsOnly -QuickTimeout -ErrorAction Stop 2>$null
    } catch { return "" }
    if (-not $r) { return "" }
    return (($r | ForEach-Object { "$($_.NameHost) $($_.Name)" }) -join " ")
}

# sample a plane a few times so we see the full weighted set, not one draw
function Sample($name, $server) {
    $aws = $false; $az = $false
    for ($i = 0; $i -lt $samples; $i++) {
        $t = Lookup $name $server
        if ($t -match $awsMark) { $aws = $true }
        if ($t -match $azMark)  { $az  = $true }
    }
    return @{ aws = $aws; az = $az }
}

function Both {
    return @{
        r53 = (Sample $apiName $r53ns)
        tm  = (Sample $tmName  $tmResolver)
    }
}

# is a cloud actually serving again (concurrency released / app started)?
function Health-Ok($url) {
    try { return ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop).StatusCode -eq 200) }
    catch { return $false }
}

function Wait-Baseline {
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $baseMaxSec) {
        $s = Both
        if ($s.r53.aws -and $s.r53.az -and $s.tm.aws -and $s.tm.az) { return $true }
        Start-Sleep -Seconds $pollSec
    }
    return $false
}

function Run-Kill($dir, $trial) {
    Write-Host ""
    Write-Host "trial $trial - kill $dir" -ForegroundColor Cyan
    if (-not (Wait-Baseline)) { Write-Host "  baseline not healthy in ${baseMaxSec}s, going anyway" -ForegroundColor Yellow }

    $t0 = Get-Date
    Write-Host ("  {0:HH:mm:ss} killing {1}" -f $t0, $dir) -ForegroundColor Red
    if ($dir -eq "aws") { Kill-Aws } else { Kill-Azure }

    $r53Rto = $null; $tmRto = $null
    $r53Hit = 0; $tmHit = 0
    $r53First = $null; $tmFirst = $null

    while ($true) {
        if (((Get-Date) - $t0).TotalSeconds -gt $maxDetectSec) { break }
        if (($r53Rto -ne $null) -and ($tmRto -ne $null)) { break }

        $now = Get-Date
        $r53 = Sample $apiName $r53ns
        $tm  = Sample $tmName  $tmResolver

        if ($dir -eq "aws") {
            $r53Over = ((-not $r53.aws) -and $r53.az)
            $tmOver  = ((-not $tm.aws)  -and $tm.az)
        } else {
            $r53Over = ((-not $r53.az) -and $r53.aws)
            $tmOver  = ((-not $tm.az)  -and $tm.aws)
        }

        if ($r53Rto -eq $null) {
            if ($r53Over) {
                if ($r53Hit -eq 0) { $r53First = $now }
                $r53Hit++
                if ($r53Hit -ge $confirm) {
                    $r53Rto = ($r53First - $t0).TotalSeconds
                    Write-Host ("  {0:HH:mm:ss} route53 failed over   {1:N1}s" -f $r53First, $r53Rto) -ForegroundColor Green
                }
            } else { $r53Hit = 0; $r53First = $null }
        }
        if ($tmRto -eq $null) {
            if ($tmOver) {
                if ($tmHit -eq 0) { $tmFirst = $now }
                $tmHit++
                if ($tmHit -ge $confirm) {
                    $tmRto = ($tmFirst - $t0).TotalSeconds
                    Write-Host ("  {0:HH:mm:ss} tm failed over        {1:N1}s" -f $tmFirst, $tmRto) -ForegroundColor Green
                }
            } else { $tmHit = 0; $tmFirst = $null }
        }
        Start-Sleep -Seconds $pollSec
    }

    if ($r53Rto -eq $null) { Write-Host "  route53 - no failover in ${maxDetectSec}s" -ForegroundColor Yellow }
    if ($tmRto  -eq $null) { Write-Host "  tm - no failover in ${maxDetectSec}s" -ForegroundColor Yellow }

    Write-Host "  restoring $dir" -ForegroundColor DarkYellow
    $rt0 = Get-Date
    if ($dir -eq "aws") { Restore-Aws } else { Restore-Azure }

    # failback: time from restore until the killed cloud reappears in each
    # plane's answer (symmetric to the failover measurement above). /health
    # must come back too - both as the recovery gate and as a safety check.
    $url = if ($dir -eq "aws") { $awsHealthUrl } else { $azHealthUrl }
    $hOk = $false
    $r53Fb = $null; $tmFb = $null
    $r53Hb = 0; $tmHb = 0
    $r53FbFirst = $null; $tmFbFirst = $null
    while (((Get-Date) - $rt0).TotalSeconds -lt $recoverMaxSec) {
        if (-not $hOk) { $hOk = Health-Ok $url }
        $now = Get-Date
        $r53 = Sample $apiName $r53ns
        $tm  = Sample $tmName  $tmResolver
        $r53Back = if ($dir -eq "aws") { $r53.aws } else { $r53.az }
        $tmBack  = if ($dir -eq "aws") { $tm.aws }  else { $tm.az }

        if ($r53Fb -eq $null) {
            if ($r53Back) {
                if ($r53Hb -eq 0) { $r53FbFirst = $now }
                $r53Hb++
                if ($r53Hb -ge $confirm) {
                    $r53Fb = ($r53FbFirst - $rt0).TotalSeconds
                    Write-Host ("  {0:HH:mm:ss} route53 back        {1:N1}s" -f $r53FbFirst, $r53Fb) -ForegroundColor DarkGreen
                }
            } else { $r53Hb = 0; $r53FbFirst = $null }
        }
        if ($tmFb -eq $null) {
            if ($tmBack) {
                if ($tmHb -eq 0) { $tmFbFirst = $now }
                $tmHb++
                if ($tmHb -ge $confirm) {
                    $tmFb = ($tmFbFirst - $rt0).TotalSeconds
                    Write-Host ("  {0:HH:mm:ss} tm back             {1:N1}s" -f $tmFbFirst, $tmFb) -ForegroundColor DarkGreen
                }
            } else { $tmHb = 0; $tmFbFirst = $null }
        }
        if ($hOk -and ($r53Fb -ne $null) -and ($tmFb -ne $null)) { Write-Host "  recovered" -ForegroundColor DarkGray; break }
        Start-Sleep -Seconds $pollSec
    }
    if (-not $hOk) {
        Write-Host "  $dir /health never came back - stopping so it doesn't wreck the next trials" -ForegroundColor Red
        Write-Host "  check the cloud is back by hand, then rerun" -ForegroundColor Red
        if ($script:rows.Count -gt 0) { $script:rows | Export-Csv $outCsv -NoTypeInformation -Encoding UTF8 }
        exit 1
    }
    Start-Sleep -Seconds $cooldownSec

    $cell = @{ "aws_route53"=1; "azure_route53"=2; "aws_traffic_manager"=3; "azure_traffic_manager"=4 }
    if ($r53Rto -ne $null) { $a = [math]::Round($r53Rto,1) } else { $a = "" }
    if ($tmRto  -ne $null) { $b = [math]::Round($tmRto,1) }  else { $b = "" }
    if ($r53Fb -ne $null) { $fa = [math]::Round($r53Fb,1) } else { $fa = "" }
    if ($tmFb  -ne $null) { $fb = [math]::Round($tmFb,1) }  else { $fb = "" }
    $ts = (Get-Date).ToString("s")

    return @(
        [pscustomobject]@{ timestamp=$ts; trial=$trial; kill_direction=$dir; control_plane="route53";         cell=$cell["${dir}_route53"];         rto_seconds=$a; failback_seconds=$fa; detected=($r53Rto -ne $null) },
        [pscustomobject]@{ timestamp=$ts; trial=$trial; kill_direction=$dir; control_plane="traffic_manager"; cell=$cell["${dir}_traffic_manager"]; rto_seconds=$b; failback_seconds=$fb; detected=($tmRto -ne $null) }
    )
}

# --- preflight: don't start unless both clouds are visible on both planes ---
Write-Host "route53 ns : $r53ns"
Write-Host "tm via     : $tmResolver"
Write-Host "logging to : $outCsv"
$pf = Both
Write-Host ("preflight  route53 aws=$($pf.r53.aws) az=$($pf.r53.az)   tm aws=$($pf.tm.aws) az=$($pf.tm.az)")
if (-not ($pf.r53.aws -and $pf.r53.az -and $pf.tm.aws -and $pf.tm.az)) {
    Write-Host "one or more endpoints not visible - fix before measuring, aborting" -ForegroundColor Red
    exit 1
}

# --- run ---
$script:rows = @()
for ($t = 1; $t -le $trials; $t++) {
    $script:rows += Run-Kill "aws"   $t
    $script:rows += Run-Kill "azure" $t
}

$script:rows | Export-Csv $outCsv -NoTypeInformation -Encoding UTF8
Write-Host ""
Write-Host "wrote $outCsv"
$script:rows | Format-Table -AutoSize

Write-Host ""
Write-Host "per-cell (keep the planes separate, don't average across them):"
$script:rows | Where-Object { $_.detected } | Group-Object cell | Sort-Object Name | ForEach-Object {
    $g = $_.Group; $l = $g | Select-Object -First 1
    $m  = $g | Measure-Object rto_seconds -Average -Minimum -Maximum
    $fb = $g | Where-Object { $_.failback_seconds -ne "" } | Measure-Object failback_seconds -Average -Minimum -Maximum
    "  cell {0} ({1}, {2}-kill): n={3}" -f $_.Name, $l.control_plane, $l.kill_direction, $g.Count
    "     failover: mean={0:N1}s min={1:N1}s max={2:N1}s" -f $m.Average, $m.Minimum, $m.Maximum
    "     failback: mean={0:N1}s min={1:N1}s max={2:N1}s" -f $fb.Average, $fb.Minimum, $fb.Maximum
}

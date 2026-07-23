# Reads the result files in this folder and prints the headline figures.
# Everything below is derived from the saved runs - nothing is hard-coded -
# so this doubles as a check that the numbers quoted elsewhere still match
# the data on disk.

$ErrorActionPreference = 'SilentlyContinue'

function Line { param($label, $value) Write-Host ("  {0,-44}{1}" -f $label, $value) }

Write-Host ""
Write-Host "=== Failover trials ===" -ForegroundColor Cyan

foreach ($side in @('Azure','AWS')) {
    $rpo    = "rpo-log-${side}_kill.csv"
    $verify = "rpo-verify-${side}_kill.csv"
    if (-not (Test-Path $rpo)) { continue }

    $writes   = @(Import-Csv $rpo)
    $ok       = @($writes | Where-Object { $_.status -eq '201' })
    $survivor = if ($side -eq 'Azure') { 'AWS' } else { 'Azure' }
    $pct      = if ($writes.Count) { [math]::Round(100 * $ok.Count / $writes.Count, 1) } else { 0 }

    Write-Host ""
    Write-Host "  $side taken out, $survivor serving" -ForegroundColor Yellow
    Line "writes attempted" $writes.Count
    Line "writes accepted" "$($ok.Count)  ($pct%)"

    if (Test-Path $verify) {
        $rows = @(Import-Csv $verify)
        # count in both directions: present on one cloud but not the other,
        # so the same check works whichever cloud was taken out
        $missing = @($rows | Where-Object {
            ($_.aws_status -eq '200' -and $_.azure_status -ne '200') -or
            ($_.azure_status -eq '200' -and $_.aws_status -ne '200')
        })
        Line "records checked on both clouds afterwards" $rows.Count
        Line "still missing after reconciliation" $missing.Count
    }
}

Write-Host ""
Write-Host "=== Load test (k6) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host ("  {0,-8}{1,10}{2,10}{3,10}{4,12}{5,9}" -f 'cloud','median','p90','p95','throughput','errors')
Write-Host ("  " + ("-" * 59))

$runsPerCloud = 0
foreach ($cloud in @('aws','azure')) {
    $files = @(Get-ChildItem "loadtest-summary-$cloud-*.json" -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { continue }
    $runsPerCloud = $files.Count

    $med = @(); $p90 = @(); $p95 = @(); $rps = @(); $err = @()
    foreach ($f in $files) {
        $j = Get-Content $f.FullName -Raw | ConvertFrom-Json
        $d = $j.metrics.http_req_duration.values
        $med += [double]$d.med
        $p90 += [double]$d.'p(90)'
        $p95 += [double]$d.'p(95)'
        $rps += [double]$j.metrics.http_reqs.values.rate
        $err += [double]$j.metrics.http_req_failed.values.rate
    }

    $mMed = [math]::Round((($med | Measure-Object -Average).Average), 0)
    $mP90 = [math]::Round((($p90 | Measure-Object -Average).Average), 0)
    $mP95 = [math]::Round((($p95 | Measure-Object -Average).Average), 0)
    $mRps = [math]::Round((($rps | Measure-Object -Average).Average), 1)
    $mErr = [math]::Round((($err | Measure-Object -Average).Average) * 100, 1)

    Write-Host ("  {0,-8}{1,10}{2,10}{3,10}{4,12}{5,9}" -f `
        $cloud, "$mMed ms", "$mP90 ms", "$mP95 ms", "$mRps /s", "$mErr%")
}
if ($runsPerCloud) {
    Write-Host ""
    Write-Host "  (mean of $runsPerCloud runs per cloud)"
}

Write-Host ""
Write-Host "=== End-to-end journey checks ===" -ForegroundColor Cyan
Write-Host ""

$total = 0; $failed = 0
foreach ($f in @(Get-ChildItem "integration-test-*.csv" -ErrorAction SilentlyContinue)) {
    $rows = @(Import-Csv $f.FullName)
    $bad  = @($rows | Where-Object { $_.result -ne 'PASS' })
    $total  += $rows.Count
    $failed += $bad.Count
    $cloud = if ($f.Name -match 'integration-test-([a-z]+)') { $matches[1] } else { $f.Name }
    Line $cloud "$($rows.Count - $bad.Count) / $($rows.Count) passed"
}
if ($total -gt 0) {
    Line "total" "$($total - $failed) / $total passed"
}
Write-Host ""

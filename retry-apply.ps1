# Retries `terraform apply -auto-approve` up to 8 times, pausing between
# attempts, to work around Azure's read-after-write consistency lag on
# this subscription. Each retry only touches whatever didn't finish yet -
# Terraform skips anything already successfully created.

$maxAttempts = 8
$waitSeconds = 45

for ($i = 1; $i -le $maxAttempts; $i++) {
    Write-Host "`n=== Attempt $i of $maxAttempts ===" -ForegroundColor Cyan
    terraform apply -auto-approve

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nSUCCESS on attempt $i" -ForegroundColor Green
        break
    }

    if ($i -lt $maxAttempts) {
        Write-Host "`nFailed, waiting ${waitSeconds}s before retry..." -ForegroundColor Yellow
        Start-Sleep -Seconds $waitSeconds
    } else {
        Write-Host "`nGave up after $maxAttempts attempts." -ForegroundColor Red
    }
}

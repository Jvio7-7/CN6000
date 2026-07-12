# Run this from the event-app root folder before `terraform apply`.
# It installs the layer's dependencies (pg, bcryptjs, jsonwebtoken) and
# zips everything Lambda needs.

Write-Host "Installing Lambda layer dependencies..."
Push-Location lambda/layer/nodejs
npm install --production
Pop-Location

Write-Host "Zipping Lambda layer..."
if (Test-Path lambda/layer.zip) { Remove-Item lambda/layer.zip }
Compress-Archive -Path lambda/layer/nodejs -DestinationPath lambda/layer.zip

Write-Host "Zipping events function..."
if (Test-Path lambda/events.zip) { Remove-Item lambda/events.zip }
Compress-Archive -Path lambda/events/index.js -DestinationPath lambda/events.zip

Write-Host "Zipping list-events function..."
if (Test-Path lambda/list-events.zip) { Remove-Item lambda/list-events.zip }
Compress-Archive -Path lambda/list-events/index.js -DestinationPath lambda/list-events.zip

Write-Host "Zipping bookings function..."
if (Test-Path lambda/bookings.zip) { Remove-Item lambda/bookings.zip }
Compress-Archive -Path lambda/bookings/index.js -DestinationPath lambda/bookings.zip

Write-Host "Zipping health function..."
if (Test-Path lambda/health.zip) { Remove-Item lambda/health.zip }
Compress-Archive -Path lambda/health/index.js -DestinationPath lambda/health.zip

Write-Host "Zipping replicate-events function..."
if (Test-Path lambda/replicate-events.zip) { Remove-Item lambda/replicate-events.zip }
Compress-Archive -Path lambda/replicate-events/index.js -DestinationPath lambda/replicate-events.zip

Write-Host "Zipping replicate-bookings function..."
if (Test-Path lambda/replicate-bookings.zip) { Remove-Item lambda/replicate-bookings.zip }
Compress-Archive -Path lambda/replicate-bookings/index.js -DestinationPath lambda/replicate-bookings.zip

Write-Host "Zipping replicate-users function..."
if (Test-Path lambda/replicate-users.zip) { Remove-Item lambda/replicate-users.zip }
Compress-Archive -Path lambda/replicate-users/index.js -DestinationPath lambda/replicate-users.zip

Write-Host "Zipping register function..."
if (Test-Path lambda/register.zip) { Remove-Item lambda/register.zip }
Compress-Archive -Path lambda/register/index.js -DestinationPath lambda/register.zip

Write-Host "Zipping login function..."
if (Test-Path lambda/login.zip) { Remove-Item lambda/login.zip }
Compress-Archive -Path lambda/login/index.js -DestinationPath lambda/login.zip

Write-Host "Zipping me function..."
if (Test-Path lambda/me.zip) { Remove-Item lambda/me.zip }
Compress-Archive -Path lambda/me/index.js -DestinationPath lambda/me.zip

Write-Host "Zipping payments function..."
if (Test-Path lambda/payments.zip) { Remove-Item lambda/payments.zip }
Compress-Archive -Path lambda/payments/index.js -DestinationPath lambda/payments.zip

Write-Host "Zipping replicate-payments function..."
if (Test-Path lambda/replicate-payments.zip) { Remove-Item lambda/replicate-payments.zip }
Compress-Archive -Path lambda/replicate-payments/index.js -DestinationPath lambda/replicate-payments.zip

Write-Host "Done. All lambda zip files are ready for Terraform."

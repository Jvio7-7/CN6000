# Run this from the event-app root folder before `terraform apply`.
# It installs the layer's dependencies (pg) and zips everything Lambda needs.

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

Write-Host "Done. All lambda zip files are ready for Terraform."

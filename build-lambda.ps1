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

Write-Host "Done. lambda/layer.zip, lambda/events.zip, lambda/bookings.zip are ready for Terraform."

# Uses the eventapp-rg resource group that Terraform already created.
# Does NOT suppress errors this time, so we can tell a real region-policy
# block apart from any other kind of failure.

$resourceGroup = "eventapp-rg"

Write-Host "Fetching full region list..."
$regions = az account list-locations --query "[].name" -o tsv

$allowed = @()

foreach ($region in $regions) {
    $name = "probe" + (Get-Random -Minimum 100000 -Maximum 999999)
    Write-Host "Trying $region..." -NoNewline

    $errOutput = az storage account create `
        --name $name `
        --resource-group $resourceGroup `
        --location $region `
        --sku Standard_LRS `
        --output none 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host " ALLOWED" -ForegroundColor Green
        $allowed += $region
        az storage account delete --name $name --resource-group $resourceGroup --yes --output none
    } else {
        if ($errOutput -match "RequestDisallowedByAzure") {
            Write-Host " blocked (region policy)" -ForegroundColor DarkGray
        } else {
            Write-Host " FAILED (other reason - see below)" -ForegroundColor Red
            Write-Host "  $errOutput" -ForegroundColor Red
        }
    }
}

Write-Host "`n=== Allowed regions ===" -ForegroundColor Cyan
if ($allowed.Count -eq 0) {
    Write-Host "None found." -ForegroundColor Red
} else {
    $allowed | ForEach-Object { Write-Host $_ -ForegroundColor Green }
}

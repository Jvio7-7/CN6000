# Sweeps ALL Azure regions (not just common ones) to find which ones this
# subscription is allowed to deploy into. Some Azure for Students accounts
# get assigned unusual regions, so we check everything rather than guessing.

$resourceGroup = "region-probe-rg"

Write-Host "Creating probe resource group..."
az group create --name $resourceGroup --location eastus2 --output none
if ($LASTEXITCODE -ne 0) {
    Write-Host "Resource group creation itself failed - trying westeurope instead..." -ForegroundColor Yellow
    az group create --name $resourceGroup --location westeurope --output none
}

Write-Host "Fetching full region list..."
$regions = az account list-locations --query "[].name" -o tsv

$allowed = @()

foreach ($region in $regions) {
    $name = "probe" + (Get-Random -Minimum 100000 -Maximum 999999)
    Write-Host "Trying $region..." -NoNewline

    az storage account create `
        --name $name `
        --resource-group $resourceGroup `
        --location $region `
        --sku Standard_LRS `
        --output none 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host " ALLOWED" -ForegroundColor Green
        $allowed += $region
        az storage account delete --name $name --resource-group $resourceGroup --yes --output none
    } else {
        Write-Host " blocked" -ForegroundColor DarkGray
    }
}

az group delete --name $resourceGroup --yes --output none

Write-Host "`n=== Allowed regions ===" -ForegroundColor Cyan
$allowed | ForEach-Object { Write-Host $_ -ForegroundColor Green }
if ($allowed.Count -eq 0) {
    Write-Host "None found - something else may be going on." -ForegroundColor Red
}

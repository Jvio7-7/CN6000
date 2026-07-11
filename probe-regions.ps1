# Probes a list of candidate regions by attempting to create a throwaway
# storage account in each. Deletes it immediately on success. Stops at
# the first region that works and prints it.

$regions = @(
    "eastus2", "centralus", "southcentralus", "westus2", "westus3",
    "northcentralus", "canadacentral", "westeurope", "northeurope",
    "southeastasia", "japanwest", "uksouth", "australiaeast", "brazilsouth"
)

$resourceGroup = "region-probe-rg"
az group create --name $resourceGroup --location eastus2 --output none

foreach ($region in $regions) {
    $name = "probe" + (Get-Random -Minimum 100000 -Maximum 999999)
    Write-Host "Trying $region..." -NoNewline

    $result = az storage account create `
        --name $name `
        --resource-group $resourceGroup `
        --location $region `
        --sku Standard_LRS `
        --output json 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host " ALLOWED" -ForegroundColor Green
        az storage account delete --name $name --resource-group $resourceGroup --yes --output none
    } else {
        Write-Host " blocked" -ForegroundColor DarkGray
    }
}

az group delete --name $resourceGroup --yes --output none
Write-Host "`nDone. Use whichever region(s) printed ALLOWED above."

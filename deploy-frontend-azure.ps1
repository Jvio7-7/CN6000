# Run from the event-app root folder. Builds the static export and
# uploads it to the storage account's $web container. No CDN purge step -
# there's no CDN in front of this (see terraform/frontend-azure/main.tf
# for why), so uploaded files are live immediately.
#
# Usage: .\deploy-frontend-azure.ps1 -StorageAccountName <storage_account_name>
# (value comes from `terraform output` in terraform\frontend-azure)

param(
    [Parameter(Mandatory = $true)][string]$StorageAccountName
)

Write-Host "Building static export..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed - fix errors above before deploying." -ForegroundColor Red
    exit 1
}

Write-Host "Uploading to `$web container on $StorageAccountName ..."
az storage blob upload-batch `
    --account-name $StorageAccountName `
    --destination '$web' `
    --source out `
    --overwrite

Write-Host "Done. Changes are live immediately - no cache to invalidate."

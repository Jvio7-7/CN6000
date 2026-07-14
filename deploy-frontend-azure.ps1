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

# az storage blob upload-batch only adds/overwrites, it never deletes -
# unlike aws s3 sync --delete on the AWS side. Clearing first avoids
# stale orphaned blobs building up (this bit us once already, when the
# output structure changed from flat account.html to account/index.html
# and the old flat files just kept sitting there unreferenced).
Write-Host "Clearing old files from `$web container..."
az storage blob delete-batch --account-name $StorageAccountName --source '$web' | Out-Null

Write-Host "Uploading to `$web container on $StorageAccountName ..."
az storage blob upload-batch `
    --account-name $StorageAccountName `
    --destination '$web' `
    --source out `
    --overwrite

Write-Host "Done. Changes are live immediately - no cache to invalidate."

# Builds the static export, syncs it to S3, and invalidates the CloudFront
# cache so the new version is served straight away.
#
# Usage: .\deploy-frontend-aws.ps1 -BucketName <bucket_name> -DistributionId <distribution_id>
# (both values come from `terraform output` in terraform\frontend-aws)

param(
    [Parameter(Mandatory = $true)][string]$BucketName,
    [Parameter(Mandatory = $true)][string]$DistributionId
)

Write-Host "Building static export..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed - fix errors above before deploying." -ForegroundColor Red
    exit 1
}

Write-Host "Syncing to s3://$BucketName ..."
aws s3 sync out/ "s3://$BucketName/" --delete

Write-Host "Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id $DistributionId --paths "/*" | Out-Null

Write-Host "Done. CloudFront can take a minute or two to fully propagate the invalidation."

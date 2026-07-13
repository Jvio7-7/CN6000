output "bucket_name" {
  description = "S3 bucket name - used by the deploy script to sync files"
  value       = aws_s3_bucket.frontend.id
}

output "cloudfront_distribution_id" {
  description = "Needed to invalidate the CloudFront cache after each deploy"
  value       = aws_cloudfront_distribution.frontend.id
}

output "site_url" {
  description = "The real, publicly accessible URL for the AWS-hosted frontend"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

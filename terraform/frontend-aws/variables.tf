variable "aws_region" {
  description = "AWS region for the S3 bucket (CloudFront itself is global regardless)"
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Prefix used for naming resources"
  type        = string
  default     = "gather"
}

variable "acm_certificate_arn" {
  description = "ACM cert ARN in us-east-1 for the CloudFront custom domain (www.gather-up.info). Issued via CLI; CloudFront only reads certs from us-east-1."
  type        = string
  default     = "arn:aws:acm:us-east-1:936049946489:certificate/20e1f7d4-e28f-4fab-af3c-ec517e9ebc55"
}
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

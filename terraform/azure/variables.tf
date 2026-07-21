variable "azure_region" {
  description = "Azure region to deploy into (constrained to student subscription's allowed list; paired with AWS ap-southeast-1 for geographic parity)"
  type        = string
  default     = "southeastasia"
}

variable "subscription_id" {
  description = "Azure subscription ID (from az account show)"
  type        = string
}

variable "project_name" {
  description = "Prefix used for naming resources"
  type        = string
  default     = "eventapp"
}

variable "sql_admin_username" {
  description = "Admin login for Azure SQL Database"
  type        = string
  default     = "eventappadmin"
}

variable "sql_admin_password" {
  description = "Admin password for Azure SQL Database"
  type        = string
  sensitive   = true
}

variable "aws_base_url" {
  description = "AWS API Gateway base URL, e.g. https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
  type        = string
}

variable "jwt_secret" {
  description = "Shared secret for signing/verifying JWTs - MUST match the value used in terraform/aws exactly, so tokens issued by either cloud validate on both"
  type        = string
  sensitive   = true
}

variable "replication_secret" {
  description = "Shared secret authenticating the internal /replicate/* endpoints - MUST match the value used in terraform/aws exactly"
  type        = string
  sensitive   = true
}

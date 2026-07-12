variable "aws_region" {
  description = "AWS region to deploy into (paired with Azure southeastasia for geographic parity)"
  type        = string
  default     = "ap-southeast-1"
}

variable "db_username" {
  description = "Master username for RDS PostgreSQL"
  type        = string
  default     = "eventappadmin"
}

variable "db_password" {
  description = "Master password for RDS PostgreSQL"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "eventdb"
}

variable "project_name" {
  description = "Prefix used for naming resources"
  type        = string
  default     = "event-app"
}

variable "azure_base_url" {
  description = "Azure Function App base URL including /api, e.g. https://eventapp-func-zhw36q.azurewebsites.net/api"
  type        = string
}

variable "jwt_secret" {
  description = "Shared secret for signing/verifying JWTs - MUST match the value used in terraform/azure exactly, so tokens issued by either cloud validate on both"
  type        = string
  sensitive   = true
}

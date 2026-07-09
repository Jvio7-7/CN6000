variable "azure_region" {
  description = "Azure region to deploy into (paired with AWS us-west-1)"
  type        = string
  default     = "West US"
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

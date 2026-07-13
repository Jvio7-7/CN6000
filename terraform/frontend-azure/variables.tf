variable "subscription_id" {
  description = "Azure subscription ID (from az account show)"
  type        = string
}

variable "azure_region" {
  description = "Azure region - matches the backend deployment for consistency"
  type        = string
  default     = "southeastasia"
}

variable "project_name" {
  description = "Prefix used for naming resources"
  type        = string
  default     = "gather"
}

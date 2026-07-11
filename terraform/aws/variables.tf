variable "aws_region" {
  description = "AWS region to deploy into"
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

variable "aws_api_domain" {
  description = "AWS API Gateway domain (no https://, no trailing slash)"
  type        = string
  default     = "l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
}

variable "aws_api_target" {
  description = "AWS API Gateway custom-domain target for the weighted record (health check still hits the raw endpoint above)"
  type        = string
  default     = "d-pmekt9ynce.execute-api.ap-southeast-1.amazonaws.com"
}

variable "azure_function_domain" {
  description = "Azure Function App domain (no https://, no trailing slash)"
  type        = string
  default     = "eventapp-func-zhw36q.azurewebsites.net"
}

variable "zone_name" {
  description = "Registered domain for the weighted failover records"
  type        = string
  default     = "gather-up.info"
}

variable "record_name" {
  description = "Subdomain under the zone that will carry the weighted failover records"
  type        = string
  default     = "api"
}

variable "replication_secret" {
  description = "Shared secret for the /replicate/* endpoints - MUST match the value in terraform/aws exactly"
  type        = string
  sensitive   = true
}

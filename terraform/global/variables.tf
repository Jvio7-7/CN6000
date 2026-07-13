variable "aws_api_domain" {
  description = "AWS API Gateway domain (no https://, no trailing slash)"
  type        = string
  default     = "l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
}

variable "azure_function_domain" {
  description = "Azure Function App domain (no https://, no trailing slash)"
  type        = string
  default     = "eventapp-func-zhw36q.azurewebsites.net"
}

variable "zone_name" {
  description = "not a real registered domain, just an id for the hosted zone - see README"
  type        = string
  default     = "cn6000-jin-fyp.com"
}

variable "record_name" {
  description = "Subdomain under the zone that will carry the weighted failover records"
  type        = string
  default     = "api"
}

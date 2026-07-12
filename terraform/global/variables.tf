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
  description = <<-EOT
    Name for the Route 53 hosted zone. This is NOT a registered/purchased
    domain — it's used purely as an identifier for the hosted zone and for
    the failover experiment. Since it isn't delegated by a real registrar,
    it won't resolve through normal public DNS; it's queried directly
    against Route 53's own assigned name servers instead. See the README
    for the exact dig/nslookup commands used to test this.
  EOT
  type    = string
  default = "cn6000-jin-fyp.com"
}

variable "record_name" {
  description = "Subdomain under the zone that will carry the weighted failover records"
  type        = string
  default     = "api"
}

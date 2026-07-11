output "zone_id" {
  description = "Route 53 hosted zone ID"
  value       = aws_route53_zone.main.zone_id
}

output "name_servers" {
  description = "Route 53's assigned name servers - query these directly for the failover experiment"
  value       = aws_route53_zone.main.name_servers
}

output "record_fqdn" {
  description = "The full name to query, e.g. dig @<name_server> <this_value> CNAME"
  value       = "${var.record_name}.${var.zone_name}"
}

output "aws_health_check_id" {
  description = "Route 53 health check ID for the AWS endpoint (useful for checking status via CLI)"
  value       = aws_route53_health_check.aws_endpoint.id
}

output "azure_health_check_id" {
  description = "Route 53 health check ID for the Azure endpoint (useful for checking status via CLI)"
  value       = aws_route53_health_check.azure_endpoint.id
}

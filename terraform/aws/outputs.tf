output "api_endpoint" {
  description = "Base URL for the deployed API"
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}

output "rds_endpoint" {
  description = "RDS PostgreSQL connection address"
  value       = aws_db_instance.postgres.address
}

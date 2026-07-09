output "function_app_name" {
  description = "Name of the deployed Function App (needed for func azure functionapp publish)"
  value       = azurerm_linux_function_app.main.name
}

output "function_app_url" {
  description = "Base URL for the deployed Function App"
  value       = "https://${azurerm_linux_function_app.main.default_hostname}"
}

output "sql_server_fqdn" {
  description = "Azure SQL Server fully qualified domain name"
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
}

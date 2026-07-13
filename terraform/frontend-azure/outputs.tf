output "storage_account_name" {
  description = "Storage account name - used by the deploy script to upload files"
  value       = azurerm_storage_account.frontend.name
}

output "site_url" {
  description = "The real, publicly accessible URL for the Azure-hosted frontend - HTTPS natively, no CDN needed"
  value       = azurerm_storage_account.frontend.primary_web_endpoint
}

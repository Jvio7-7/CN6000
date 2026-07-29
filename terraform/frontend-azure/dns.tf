# --- DNS / Traffic Manager (merged in from the old azure-dns and
# traffic-manager stacks) ---
# These sit in this stack's resource group (gather-frontend-rg), which is why
# they moved here rather than into the backend stack.

locals {
  aws_api_host    = "l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
  azure_api_host  = "eventapp-func-zhw36q.azurewebsites.net"
  cloudfront_host = "d2w4sqsrci41oa.cloudfront.net"
}

# Azure-side control plane: probes both origins on /health and does its own
# weighted 50/50 failover, compared against Route 53 in the RTO measurement.
resource "azurerm_traffic_manager_profile" "api" {
  name                   = "gather-api-tm"
  resource_group_name    = azurerm_resource_group.frontend.name
  traffic_routing_method = "Weighted"

  dns_config {
    relative_name = "gather-api-tm"
    ttl           = 30
  }

  monitor_config {
    protocol                     = "HTTPS"
    port                         = 443
    path                         = "/health"
    interval_in_seconds          = 30
    timeout_in_seconds           = 10
    tolerated_number_of_failures = 3
  }
}

resource "azurerm_traffic_manager_external_endpoint" "aws" {
  name       = "aws"
  profile_id = azurerm_traffic_manager_profile.api.id
  target     = local.aws_api_host
  weight     = 50
}

resource "azurerm_traffic_manager_external_endpoint" "azure" {
  name       = "azure"
  profile_id = azurerm_traffic_manager_profile.api.id
  target     = local.azure_api_host
  weight     = 50
}

# Azure DNS zone: the Azure-side authoritative copy of gather-up.info, mirroring
# the Route 53 records so either provider answers consistently.
resource "azurerm_dns_zone" "main" {
  name                = "gather-up.info"
  resource_group_name = azurerm_resource_group.frontend.name
}

resource "azurerm_dns_cname_record" "api" {
  name                = "api"
  zone_name           = azurerm_dns_zone.main.name
  resource_group_name = azurerm_resource_group.frontend.name
  ttl                 = 30
  record              = azurerm_traffic_manager_profile.api.fqdn
}

resource "azurerm_dns_cname_record" "www" {
  name                = "www"
  zone_name           = azurerm_dns_zone.main.name
  resource_group_name = azurerm_resource_group.frontend.name
  ttl                 = 30
  record              = local.cloudfront_host
}

# validation records mirrored from Route 53
resource "azurerm_dns_cname_record" "acm_api" {
  name                = "_8e0f67f239be0c2a220ddee04a421f74.api"
  zone_name           = azurerm_dns_zone.main.name
  resource_group_name = azurerm_resource_group.frontend.name
  ttl                 = 300
  record              = "_08e8a8c9be35c032edf9eb88e8c66499.jkddzztszm.acm-validations.aws."
}

resource "azurerm_dns_cname_record" "acm_www" {
  name                = "_5897095fd07bf05fceaaa1a8586b2779.www"
  zone_name           = azurerm_dns_zone.main.name
  resource_group_name = azurerm_resource_group.frontend.name
  ttl                 = 300
  record              = "_ad033d87b4842cd3ec224a8f854fc72f.jkddzztszm.acm-validations.aws."
}

resource "azurerm_dns_txt_record" "asuid_api" {
  name                = "asuid.api"
  zone_name           = azurerm_dns_zone.main.name
  resource_group_name = azurerm_resource_group.frontend.name
  ttl                 = 300
  record {
    value = "4FB6AA482E731C0092318AE79FF5A1319488437DCB4AEC276E56A5996AD47E83"
  }
}

output "tm_fqdn" {
  value = azurerm_traffic_manager_profile.api.fqdn
}

output "azure_name_servers" {
  value = azurerm_dns_zone.main.name_servers
}

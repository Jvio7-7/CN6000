terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_resource_group" "frontend" {
  name     = "${var.project_name}-frontend-rg"
  location = var.azure_region
}

# separate storage account from the Function App's one, keeps
# public hosting separate from internal plumbing
resource "azurerm_storage_account" "frontend" {
  name                     = "${var.project_name}fe${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.frontend.name
  location                 = azurerm_resource_group.frontend.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  static_website {
    index_document     = "index.html"
    error_404_document = "404.html"
  }
}

# no CDN here unlike AWS - tried, but Azure stopped allowing new classic
# CDN profiles and the replacement (Front Door) costs ~$35/mo. don't need
# it anyway since this endpoint does HTTPS natively (S3's doesn't, which
# is why CloudFront exists on the AWS side)

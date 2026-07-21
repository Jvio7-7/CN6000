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
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.11"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # "none" = exact equivalent of the old skip_provider_registration = true -
  # every resource provider this project needs was already registered on
  # the subscription during the original v3 deployment, and registration
  # is a subscription-level state that persists regardless of what this
  # setting is, so this preserves existing behaviour rather than opting
  # into v4's new auto-registration modes untested
  resource_provider_registrations = "none"
}

# random suffix so names don't clash with other students
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_resource_group" "main" {
  name     = "${var.project_name}-rg"
  location = var.azure_region
}

# every Function App needs a storage account for its own bookkeeping

resource "azurerm_storage_account" "main" {
  name                     = "${var.project_name}st${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

# azure is sometimes slow to make new resources actually readable,
# so give it a bit before anything else tries to use this
resource "time_sleep" "wait_storage" {
  depends_on      = [azurerm_storage_account.main]
  create_duration = "30s"
}

# Y1 = consumption plan, pay per execution like Lambda

resource "azurerm_service_plan" "main" {
  name                = "${var.project_name}-plan"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "main" {
  name                       = "${var.project_name}-func-${random_string.suffix.result}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  service_plan_id            = azurerm_service_plan.main.id
  storage_account_name       = azurerm_storage_account.main.name
  storage_account_access_key = azurerm_storage_account.main.primary_access_key
  depends_on                 = [time_sleep.wait_storage]

  site_config {
    application_stack {
      node_version = "22"
    }
    cors {
      allowed_origins = ["*"]
    }
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME = "node"
    DB_SERVER                = azurerm_mssql_server.main.fully_qualified_domain_name
    DB_NAME                  = azurerm_mssql_database.main.name
    DB_USER                  = var.sql_admin_username
    DB_PASSWORD              = var.sql_admin_password
    AWS_BASE_URL             = var.aws_base_url
    JWT_SECRET               = var.jwt_secret
    REPLICATION_SECRET       = var.replication_secret
  }
  lifecycle {
    ignore_changes = [
      app_settings["WEBSITE_RUN_FROM_PACKAGE"],
      app_settings["WEBSITE_MOUNT_ENABLED"],
    ]
  }
}

# Basic tier, cheapest option

resource "azurerm_mssql_server" "main" {
  name                         = "${var.project_name}-sql-${random_string.suffix.result}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = var.sql_admin_username
  administrator_login_password = var.sql_admin_password
}

# same lag issue as the storage account
resource "time_sleep" "wait_sql_server" {
  depends_on      = [azurerm_mssql_server.main]
  create_duration = "30s"
}

resource "azurerm_mssql_database" "main" {
  name        = "eventdb"
  server_id   = azurerm_mssql_server.main.id
  sku_name    = "Basic"
  max_size_gb = 2
  depends_on  = [time_sleep.wait_sql_server]
}

# lets the Function App reach the SQL server (no fixed outbound IP
# on consumption plan, so can't whitelist a specific address)
resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
  depends_on       = [time_sleep.wait_sql_server]
}

# so I can run schema-mssql.sql from my own machine
data "http" "my_ip" {
  url = "https://api.ipify.org"
}

resource "azurerm_mssql_firewall_rule" "allow_my_ip" {
  name             = "AllowMyIP"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = data.http.my_ip.response_body
  end_ip_address   = data.http.my_ip.response_body
  depends_on       = [time_sleep.wait_sql_server]
}

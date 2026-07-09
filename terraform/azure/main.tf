terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# Storage accounts, Function App hostnames, and SQL Server names must all
# be globally unique across Azure, not just within this subscription — so
# we append a random suffix to avoid clashing with every other student
# doing the same CN6000 assignment.
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_resource_group" "main" {
  name     = "${var.project_name}-rg"
  location = var.azure_region
}

# -------------------------------------------------------------------------
# Storage account — required by every Function App for internal bookkeeping
# (triggers, logs, state), not used directly by our own code.
# -------------------------------------------------------------------------

resource "azurerm_storage_account" "main" {
  name                     = "${var.project_name}st${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

# -------------------------------------------------------------------------
# Consumption plan (Y1) — this is what makes it "serverless": pay per
# execution, scales to zero, matches AWS Lambda's pricing model.
# -------------------------------------------------------------------------

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

  site_config {
    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME = "node"
    DB_SERVER                = azurerm_mssql_server.main.fully_qualified_domain_name
    DB_NAME                  = azurerm_mssql_database.main.name
    DB_USER                  = var.sql_admin_username
    DB_PASSWORD              = var.sql_admin_password
  }
}

# -------------------------------------------------------------------------
# Azure SQL Database — the Azure-side equivalent of RDS PostgreSQL.
# Basic tier is intentionally minimal/cheap, matches the coursework scale.
# -------------------------------------------------------------------------

resource "azurerm_mssql_server" "main" {
  name                         = "${var.project_name}-sql-${random_string.suffix.result}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = var.sql_admin_username
  administrator_login_password = var.sql_admin_password
}

resource "azurerm_mssql_database" "main" {
  name        = "eventdb"
  server_id   = azurerm_mssql_server.main.id
  sku_name    = "Basic"
  max_size_gb = 2
}

# Allows Azure services (including our Consumption-plan Function App,
# which doesn't have a fixed outbound IP) to reach the SQL server. This
# is Azure's standard "Allow Azure services" rule, not a public-internet
# opt-in — same intent as the AWS side's RDS security group note, but
# Azure's mechanism for it.
resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Allows your own machine to connect directly (e.g. to run schema-mssql.sql
# with sqlcmd). Uses whatever your current public IP is at apply time.
data "http" "my_ip" {
  url = "https://api.ipify.org"
}

resource "azurerm_mssql_firewall_rule" "allow_my_ip" {
  name             = "AllowMyIP"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = data.http.my_ip.response_body
  end_ip_address   = data.http.my_ip.response_body
}

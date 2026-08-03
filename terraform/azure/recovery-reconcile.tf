# Azure-side auto-reconcile. An App Insights availability test pings AWS
# /health; when AWS recovers, a metric alert fires a webhook to the
# recovery-reconcile function, which pushes Azure's rows back.
# Standard tests only run every 5 min, so this side is slower than AWS's 30s.

# Secret guarding the recovery endpoint. Azure Monitor webhooks cannot send a
# custom header, so the secret travels in the query string instead.
variable "recovery_secret" {
  description = "Shared secret guarding the internal recovery-reconcile endpoint"
  type        = string
  sensitive   = true
}

resource "azurerm_application_insights" "monitor" {
  name                = "${var.project_name}-recovery-ai"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
}

# Pings AWS /health from Azure. The availability metric dropping means AWS
# is down; its return to 100 is the recovery signal.
resource "azurerm_application_insights_standard_web_test" "aws_health" {
  name                    = "${var.project_name}-aws-health-test"
  resource_group_name     = azurerm_resource_group.main.name
  location                = azurerm_resource_group.main.location
  application_insights_id = azurerm_application_insights.monitor.id
  geo_locations           = ["apac-hk-hkn-azr", "apac-jp-kaw-edge"]
  frequency               = 300
  timeout                 = 30
  enabled                 = true

  request {
    url = "https://${var.aws_base_url_host}/health"
  }

  validation_rules {
    expected_status_code        = 200
    ssl_check_enabled           = true
    ssl_cert_remaining_lifetime = 7
  }
}

# Action group with a webhook to the recovery-reconcile function. The secret is
# in the query string because webhooks cannot set custom headers. No /api in
# the path - host.json sets routePrefix to empty.
resource "azurerm_monitor_action_group" "recovery" {
  name                = "${var.project_name}-recovery-ag"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "recovery"

  webhook_receiver {
    name        = "recovery-reconcile"
    service_uri = "https://${azurerm_linux_function_app.main.default_hostname}/internal/recovery-reconcile?key=${var.recovery_secret}"
  }
}

# Fires while AWS is unhealthy, and the action group is invoked again on
# resolution - that resolution is what triggers the reconcile.
resource "azurerm_monitor_metric_alert" "aws_down" {
  name                = "${var.project_name}-aws-endpoint-down"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_application_insights.monitor.id]
  description         = "AWS endpoint availability; resolution triggers reconcile from Azure."
  frequency           = "PT5M"
  window_size         = "PT5M"
  severity            = 3

  criteria {
    metric_namespace = "microsoft.insights/components"
    metric_name      = "availabilityResults/availabilityPercentage"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 100

    dimension {
      name     = "availabilityResult/name"
      operator = "Include"
      values   = [azurerm_application_insights_standard_web_test.aws_health.name]
    }
  }

  action {
    action_group_id = azurerm_monitor_action_group.recovery.id
  }
}

output "recovery_web_test" {
  description = "Name of the Application Insights availability test watching AWS"
  value       = azurerm_application_insights_standard_web_test.aws_health.name
}

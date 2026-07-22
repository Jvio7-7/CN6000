# ---------------------------------------------------------------------------
# Azure-side automatic reconciliation on AWS recovery (Option B2).
#
# This is the mirror of the AWS CloudWatch alarm. Here Azure independently
# monitors the AWS endpoint using native Azure tooling and, when AWS recovers,
# reconciles Azure's rows back to AWS. With both halves in place, either cloud
# failing and returning now triggers an automatic resync in the right
# direction, orchestrated by the surviving cloud.
#
# Chain:
#   Application Insights availability test pings the AWS /health endpoint
#     -> metric alert fires on the availability metric
#       -> action group webhook
#         -> the dedicated recovery-reconcile function on Azure
#           -> reconcileToPeer() pushes Azure rows to AWS
#
# Caveats (documented deliberately, not hidden):
# - Standard availability tests run at a 5-minute minimum frequency, so Azure
#   detects AWS recovery more slowly than AWS detects Azure recovery (30s
#   Route 53 checks). The two directions are symmetric in existence but not in
#   reaction time. This is a limitation of the platform tooling, not the design.
# - Some Azure for Students subscriptions restrict availability web tests. If
#   this stack fails to provision here, the timer-based alternative (a
#   scheduled function polling AWS /health) achieves the same outcome without
#   Application Insights.
# ---------------------------------------------------------------------------

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

# Availability test that pings the AWS health endpoint from Azure. A drop in
# the availabilityResults/availabilityPercentage metric means AWS is down; its
# return to 100 is the recovery signal.
resource "azurerm_application_insights_standard_web_test" "aws_health" {
  name                    = "${var.project_name}-aws-health-test"
  resource_group_name     = azurerm_resource_group.main.name
  location                = azurerm_resource_group.main.location
  application_insights_id = azurerm_application_insights.monitor.id
  geo_locations           = ["apac-sg-sin-edge"]
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
# in the query string because webhooks cannot set custom headers.
resource "azurerm_monitor_action_group" "recovery" {
  name                = "${var.project_name}-recovery-ag"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "recovery"

  webhook_receiver {
    name        = "recovery-reconcile"
    service_uri = "https://${azurerm_linux_function_app.main.default_hostname}/api/internal/recovery-reconcile?key=${var.recovery_secret}"
  }
}

# Alert on the availability metric. It fires while AWS is unhealthy and, more
# usefully for us, its action group is also invoked on resolution. We keep the
# window tight so recovery is noticed on the next evaluation after AWS returns.
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

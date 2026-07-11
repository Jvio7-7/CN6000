terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Route 53 is a global service, but the provider block still needs *a*
# region for API calls — us-east-1 is the conventional choice since it's
# where Route 53's control plane actually lives.
provider "aws" {
  region = "us-east-1"
}

# -------------------------------------------------------------------------
# Hosted zone
#
# Not delegated by a real domain registrar (see variables.tf) — used to
# host the failover records and health checks, queried directly against
# its own name servers for the RTO experiment rather than through public
# DNS. This is a deliberate, documented scope simplification: it isolates
# the measurement to Route 53's own failover logic without conflating it
# with public DNS caching/TTL behaviour elsewhere in the resolution chain.
# -------------------------------------------------------------------------

resource "aws_route53_zone" "main" {
  name = var.zone_name
}

# -------------------------------------------------------------------------
# Health checks
#
# Both hit the real /health (AWS) and /api/health (Azure) endpoints, which
# themselves run a live SELECT 1 against each cloud's database — so this
# reflects genuine end-to-end health, not just "is the compute layer warm".
# -------------------------------------------------------------------------

resource "aws_route53_health_check" "aws_endpoint" {
  fqdn              = var.aws_api_domain
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Name = "aws-lambda-health"
  }
}

resource "aws_route53_health_check" "azure_endpoint" {
  fqdn              = var.azure_function_domain
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Name = "azure-functions-health"
  }
}

# -------------------------------------------------------------------------
# Weighted, health-checked records — this is what makes it Active/Active
# rather than Active/Passive. Both clouds serve traffic under normal
# conditions (50/50 split); if either health check fails, Route 53
# automatically stops returning that record, so all resolution shifts to
# the surviving cloud without any manual intervention.
# -------------------------------------------------------------------------

resource "aws_route53_record" "api_aws" {
  zone_id        = aws_route53_zone.main.zone_id
  name           = var.record_name
  type           = "CNAME"
  ttl            = 30
  records        = [var.aws_api_domain]
  set_identifier = "aws"

  weighted_routing_policy {
    weight = 50
  }

  health_check_id = aws_route53_health_check.aws_endpoint.id
}

resource "aws_route53_record" "api_azure" {
  zone_id        = aws_route53_zone.main.zone_id
  name           = var.record_name
  type           = "CNAME"
  ttl            = 30
  records        = [var.azure_function_domain]
  set_identifier = "azure"

  weighted_routing_policy {
    weight = 50
  }

  health_check_id = aws_route53_health_check.azure_endpoint.id
}

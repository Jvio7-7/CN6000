terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

# Route 53 is global but the provider still wants a region
provider "aws" {
  region = "us-east-1"
}

# no real domain bought for this - zone isn't publicly delegated,
# tested by querying the name servers directly instead

resource "aws_route53_zone" "main" {
  name = var.zone_name
}

# these hit the real /health endpoints, which run a SELECT 1 against
# the db, so it's a genuine health check not just "is the function warm"

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

# 50/50 weighted, both clouds serve traffic normally. if either health
# check fails, Route 53 stops returning that one automatically

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

# Frontend DNS (task B). www.gather-up.info is active/active across both
# clouds - weighted 50/50 with health checks, mirroring the api. record.
# The apex can only ALIAS to an AWS resource: Route 53 has no CNAME
# flattening and Azure Front Door exposes no stable IP, so the apex cannot
# be pointed at Azure. The apex is therefore AWS-anchored and www is the
# canonical, failover-capable URL. The Azure side of the www record is
# added alongside the Front Door stage.

variable "aws_frontend_domain" {
  description = "CloudFront distribution domain for the AWS frontend (no https://, no trailing slash)"
  type        = string
  default     = "d2w4sqsrci41oa.cloudfront.net"
}

resource "aws_route53_health_check" "aws_frontend" {
  fqdn              = var.aws_frontend_domain
  port              = 443
  type              = "HTTPS"
  resource_path     = "/"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Name = "aws-cloudfront-frontend-health"
  }
}

resource "aws_route53_record" "www_aws" {
  zone_id        = aws_route53_zone.main.zone_id
  name           = "www"
  type           = "CNAME"
  ttl            = 30
  records        = [var.aws_frontend_domain]
  set_identifier = "aws"

  weighted_routing_policy {
    weight = 50
  }

  health_check_id = aws_route53_health_check.aws_frontend.id
}

# apex must be an ALIAS (DNS forbids CNAME at the zone root); target is the
# CloudFront distribution. Z2FDTNDATAQYW2 is the fixed global CloudFront
# hosted-zone id used for all alias records to CloudFront.
resource "aws_route53_record" "apex_aws" {
  zone_id = aws_route53_zone.main.zone_id
  name    = ""
  type    = "A"

  alias {
    name                   = var.aws_frontend_domain
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}
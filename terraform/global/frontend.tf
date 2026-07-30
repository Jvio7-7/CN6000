# Frontend DNS. www.gather-up.info points at the AWS frontend (CloudFront).
# The apex isn't used: Route 53 can only ALIAS an apex to an AWS resource,
# and the Azure frontend has no custom domain (Front Door is blocked on the
# student account), so www is the canonical URL.

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

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# -------------------------------------------------------------------------
# RDS PostgreSQL
#
# NOTE on security: this is deliberately kept simple for a coursework
# deployment. The DB is publicly accessible so that Lambda functions
# running outside a VPC (no NAT Gateway needed, avoids extra cost) can
# reach it directly. Inbound is restricted to port 5432 from anywhere,
# which is NOT production-safe — in a real deployment this would sit in
# a private subnet reachable only from Lambda's VPC security group. This
# tradeoff is intentional and documented for the report's Design chapter.
# -------------------------------------------------------------------------

resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "Allow Postgres access for coursework RDS instance"

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.project_name}-db"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  storage_type           = "gp2"
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  publicly_accessible    = true
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  skip_final_snapshot    = true
}

# -------------------------------------------------------------------------
# Lambda layer (shared pg dependency + db.js helper)
# Build with build-lambda.ps1 before running terraform apply.
# -------------------------------------------------------------------------

resource "aws_lambda_layer_version" "db_layer" {
  layer_name          = "${var.project_name}-db-layer"
  filename            = "${path.module}/../../lambda/layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../../lambda/layer.zip")
  compatible_runtimes = ["nodejs20.x"]
}

# -------------------------------------------------------------------------
# IAM role shared by both Lambda functions
# -------------------------------------------------------------------------

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# -------------------------------------------------------------------------
# Lambda functions
# -------------------------------------------------------------------------

resource "aws_lambda_function" "create_event" {
  function_name    = "${var.project_name}-create-event"
  filename         = "${path.module}/../../lambda/events.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/events.zip")
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    }
  }
}

resource "aws_lambda_function" "book_event" {
  function_name    = "${var.project_name}-book-event"
  filename         = "${path.module}/../../lambda/bookings.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/bookings.zip")
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    }
  }
}

# -------------------------------------------------------------------------
# API Gateway (HTTP API) — routes requests to the two Lambda functions
# -------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "create_event" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_event.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "book_event" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.book_event.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_event" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /events"
  target    = "integrations/${aws_apigatewayv2_integration.create_event.id}"
}

resource "aws_apigatewayv2_route" "book_event" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /bookings"
  target    = "integrations/${aws_apigatewayv2_integration.book_event.id}"
}

resource "aws_lambda_permission" "create_event_apigw" {
  statement_id  = "AllowAPIGatewayInvokeCreateEvent"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_event.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "book_event_apigw" {
  statement_id  = "AllowAPIGatewayInvokeBookEvent"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.book_event.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

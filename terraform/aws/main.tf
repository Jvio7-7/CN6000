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
  compatible_runtimes = ["nodejs22.x"]
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
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL   = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      AZURE_BASE_URL = var.azure_base_url
    }
  }
}

resource "aws_lambda_function" "book_event" {
  function_name    = "${var.project_name}-book-event"
  filename         = "${path.module}/../../lambda/bookings.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/bookings.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL   = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      AZURE_BASE_URL = var.azure_base_url
    }
  }
}

resource "aws_lambda_function" "list_events" {
  function_name    = "${var.project_name}-list-events"
  filename         = "${path.module}/../../lambda/list-events.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/list-events.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    }
  }
}

resource "aws_lambda_function" "health" {
  function_name    = "${var.project_name}-health"
  filename         = "${path.module}/../../lambda/health.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/health.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 5

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    }
  }
}

# -------------------------------------------------------------------------
# Replication endpoints - receive writes that originated on Azure and were
# forwarded here. These never replicate further (one-hop only, no ping-pong).
# -------------------------------------------------------------------------

resource "aws_lambda_function" "replicate_events" {
  function_name    = "${var.project_name}-replicate-events"
  filename         = "${path.module}/../../lambda/replicate-events.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/replicate-events.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    }
  }
}

resource "aws_lambda_function" "replicate_bookings" {
  function_name    = "${var.project_name}-replicate-bookings"
  filename         = "${path.module}/../../lambda/replicate-bookings.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/replicate-bookings.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
    }
  }
}

resource "aws_lambda_function" "replicate_users" {
  function_name    = "${var.project_name}-replicate-users"
  filename         = "${path.module}/../../lambda/replicate-users.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/replicate-users.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
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
# User accounts - registration, login, and the "me" endpoint. JWT_SECRET
# must match terraform/azure's value exactly so a token issued by either
# cloud is valid on both.
# -------------------------------------------------------------------------

resource "aws_lambda_function" "register" {
  function_name    = "${var.project_name}-register"
  filename         = "${path.module}/../../lambda/register.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/register.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL   = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      AZURE_BASE_URL = var.azure_base_url
      JWT_SECRET     = var.jwt_secret
    }
  }
}

resource "aws_lambda_function" "login" {
  function_name    = "${var.project_name}-login"
  filename         = "${path.module}/../../lambda/login.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/login.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      JWT_SECRET   = var.jwt_secret
    }
  }
}

resource "aws_lambda_function" "me" {
  function_name    = "${var.project_name}-me"
  filename         = "${path.module}/../../lambda/me.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/me.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      JWT_SECRET   = var.jwt_secret
    }
  }
}

# -------------------------------------------------------------------------
# Simulated payments - no real processor involved. See sql/schema-postgres.sql
# for the decline-simulation convention.
# -------------------------------------------------------------------------

resource "aws_lambda_function" "payments" {
  function_name    = "${var.project_name}-payments"
  filename         = "${path.module}/../../lambda/payments.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/payments.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 10

  environment {
    variables = {
      DATABASE_URL   = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      AZURE_BASE_URL = var.azure_base_url
    }
  }
}

resource "aws_lambda_function" "replicate_payments" {
  function_name    = "${var.project_name}-replicate-payments"
  filename         = "${path.module}/../../lambda/replicate-payments.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/replicate-payments.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
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

resource "aws_apigatewayv2_integration" "list_events" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_events.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "book_event" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.book_event.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "health" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.health.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "replicate_events" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.replicate_events.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "replicate_bookings" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.replicate_bookings.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "replicate_users" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.replicate_users.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "register" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.register.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "login" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.login.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "me" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.me.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "payments" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.payments.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "replicate_payments" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.replicate_payments.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_event" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /events"
  target    = "integrations/${aws_apigatewayv2_integration.create_event.id}"
}

resource "aws_apigatewayv2_route" "list_events" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /events"
  target    = "integrations/${aws_apigatewayv2_integration.list_events.id}"
}

resource "aws_apigatewayv2_route" "book_event" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /bookings"
  target    = "integrations/${aws_apigatewayv2_integration.book_event.id}"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "replicate_events" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /replicate/events"
  target    = "integrations/${aws_apigatewayv2_integration.replicate_events.id}"
}

resource "aws_apigatewayv2_route" "replicate_bookings" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /replicate/bookings"
  target    = "integrations/${aws_apigatewayv2_integration.replicate_bookings.id}"
}

resource "aws_apigatewayv2_route" "replicate_users" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /replicate/users"
  target    = "integrations/${aws_apigatewayv2_integration.replicate_users.id}"
}

resource "aws_apigatewayv2_route" "register" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /users/register"
  target    = "integrations/${aws_apigatewayv2_integration.register.id}"
}

resource "aws_apigatewayv2_route" "login" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /users/login"
  target    = "integrations/${aws_apigatewayv2_integration.login.id}"
}

resource "aws_apigatewayv2_route" "me" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /users/me"
  target    = "integrations/${aws_apigatewayv2_integration.me.id}"
}

resource "aws_apigatewayv2_route" "payments" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /payments"
  target    = "integrations/${aws_apigatewayv2_integration.payments.id}"
}

resource "aws_apigatewayv2_route" "replicate_payments" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /replicate/payments"
  target    = "integrations/${aws_apigatewayv2_integration.replicate_payments.id}"
}

resource "aws_lambda_permission" "create_event_apigw" {
  statement_id  = "AllowAPIGatewayInvokeCreateEvent"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_event.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "list_events_apigw" {
  statement_id  = "AllowAPIGatewayInvokeListEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_events.function_name
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

resource "aws_lambda_permission" "health_apigw" {
  statement_id  = "AllowAPIGatewayInvokeHealth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "replicate_events_apigw" {
  statement_id  = "AllowAPIGatewayInvokeReplicateEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.replicate_events.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "replicate_bookings_apigw" {
  statement_id  = "AllowAPIGatewayInvokeReplicateBookings"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.replicate_bookings.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "replicate_users_apigw" {
  statement_id  = "AllowAPIGatewayInvokeReplicateUsers"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.replicate_users.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "register_apigw" {
  statement_id  = "AllowAPIGatewayInvokeRegister"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.register.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "login_apigw" {
  statement_id  = "AllowAPIGatewayInvokeLogin"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.login.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "me_apigw" {
  statement_id  = "AllowAPIGatewayInvokeMe"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.me.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "payments_apigw" {
  statement_id  = "AllowAPIGatewayInvokePayments"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.payments.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "replicate_payments_apigw" {
  statement_id  = "AllowAPIGatewayInvokeReplicatePayments"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.replicate_payments.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

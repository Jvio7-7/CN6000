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

# RDS - publicly accessible so Lambda outside a VPC can reach it (skips
# needing a NAT gateway). not how I'd do this for something real.

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

# run build-lambda.ps1 before applying

resource "aws_lambda_layer_version" "db_layer" {
  layer_name          = "${var.project_name}-db-layer"
  filename            = "${path.module}/../../lambda/layer.zip"
  source_code_hash    = filebase64sha256("${path.module}/../../lambda/layer.zip")
  compatible_runtimes = ["nodejs22.x"]
}

# shared IAM role for all the lambdas

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
      JWT_SECRET     = var.jwt_secret
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
      JWT_SECRET     = var.jwt_secret
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

# these receive writes forwarded from Azure, one hop only, no loop

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

resource "aws_lambda_function" "reconcile" {
  function_name    = "${var.project_name}-reconcile"
  filename         = "${path.module}/../../lambda/reconcile.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/reconcile.zip")
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_exec.arn
  layers           = [aws_lambda_layer_version.db_layer.arn]
  timeout          = 60

  environment {
    variables = {
      DATABASE_URL   = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.address}:5432/${var.db_name}"
      AZURE_BASE_URL = var.azure_base_url
    }
  }
}

# jwt_secret has to match terraform/azure exactly

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

resource "aws_lambda_function" "forgot_password" {
  function_name    = "${var.project_name}-forgot-password"
  filename         = "${path.module}/../../lambda/forgot-password.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/forgot-password.zip")
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

resource "aws_lambda_function" "reset_password" {
  function_name    = "${var.project_name}-reset-password"
  filename         = "${path.module}/../../lambda/reset-password.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/reset-password.zip")
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

# -------------------------------------------------------------------------
# Profile edit, password change, and ownership-based cancel/list for
# events and bookings
# -------------------------------------------------------------------------

resource "aws_lambda_function" "update_profile" {
  function_name    = "${var.project_name}-update-profile"
  filename         = "${path.module}/../../lambda/update-profile.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/update-profile.zip")
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

resource "aws_lambda_function" "change_password" {
  function_name    = "${var.project_name}-change-password"
  filename         = "${path.module}/../../lambda/change-password.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/change-password.zip")
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

resource "aws_lambda_function" "cancel_event" {
  function_name    = "${var.project_name}-cancel-event"
  filename         = "${path.module}/../../lambda/cancel-event.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/cancel-event.zip")
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

resource "aws_lambda_function" "cancel_booking" {
  function_name    = "${var.project_name}-cancel-booking"
  filename         = "${path.module}/../../lambda/cancel-booking.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/cancel-booking.zip")
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

resource "aws_lambda_function" "my_events" {
  function_name    = "${var.project_name}-my-events"
  filename         = "${path.module}/../../lambda/my-events.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/my-events.zip")
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

resource "aws_lambda_function" "my_bookings" {
  function_name    = "${var.project_name}-my-bookings"
  filename         = "${path.module}/../../lambda/my-bookings.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/my-bookings.zip")
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

# fake payments, see sql/schema-postgres.sql

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

# fake notifications, not replicated

resource "aws_lambda_function" "list_notifications" {
  function_name    = "${var.project_name}-list-notifications"
  filename         = "${path.module}/../../lambda/list-notifications.zip"
  source_code_hash = filebase64sha256("${path.module}/../../lambda/list-notifications.zip")
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

# API Gateway routes

resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PATCH", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
  }
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

resource "aws_apigatewayv2_integration" "reconcile" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.reconcile.invoke_arn
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

resource "aws_apigatewayv2_integration" "forgot_password" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.forgot_password.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "reset_password" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.reset_password.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "update_profile" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.update_profile.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "change_password" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.change_password.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "cancel_event" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.cancel_event.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "cancel_booking" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.cancel_booking.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "my_events" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.my_events.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "my_bookings" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.my_bookings.invoke_arn
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

resource "aws_apigatewayv2_integration" "list_notifications" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.list_notifications.invoke_arn
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

resource "aws_apigatewayv2_route" "reconcile" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /replicate/reconcile"
  target    = "integrations/${aws_apigatewayv2_integration.reconcile.id}"
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

resource "aws_apigatewayv2_route" "forgot_password" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /users/forgot-password"
  target    = "integrations/${aws_apigatewayv2_integration.forgot_password.id}"
}

resource "aws_apigatewayv2_route" "reset_password" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /users/reset-password"
  target    = "integrations/${aws_apigatewayv2_integration.reset_password.id}"
}

resource "aws_apigatewayv2_route" "update_profile" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "PATCH /users/me"
  target    = "integrations/${aws_apigatewayv2_integration.update_profile.id}"
}

resource "aws_apigatewayv2_route" "change_password" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /users/change-password"
  target    = "integrations/${aws_apigatewayv2_integration.change_password.id}"
}

resource "aws_apigatewayv2_route" "cancel_event" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /events/{id}/cancel"
  target    = "integrations/${aws_apigatewayv2_integration.cancel_event.id}"
}

resource "aws_apigatewayv2_route" "cancel_booking" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "POST /bookings/{id}/cancel"
  target    = "integrations/${aws_apigatewayv2_integration.cancel_booking.id}"
}

resource "aws_apigatewayv2_route" "my_events" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /users/me/events"
  target    = "integrations/${aws_apigatewayv2_integration.my_events.id}"
}

resource "aws_apigatewayv2_route" "my_bookings" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /users/me/bookings"
  target    = "integrations/${aws_apigatewayv2_integration.my_bookings.id}"
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

resource "aws_apigatewayv2_route" "list_notifications" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "GET /notifications"
  target    = "integrations/${aws_apigatewayv2_integration.list_notifications.id}"
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

resource "aws_lambda_permission" "reconcile_apigw" {
  statement_id  = "AllowAPIGatewayInvokeReconcile"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reconcile.function_name
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

resource "aws_lambda_permission" "list_notifications_apigw" {
  statement_id  = "AllowAPIGatewayInvokeListNotifications"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.list_notifications.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "forgot_password_apigw" {
  statement_id  = "AllowAPIGatewayInvokeForgotPassword"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.forgot_password.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "reset_password_apigw" {
  statement_id  = "AllowAPIGatewayInvokeResetPassword"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reset_password.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "update_profile_apigw" {
  statement_id  = "AllowAPIGatewayInvokeUpdateProfile"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_profile.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "change_password_apigw" {
  statement_id  = "AllowAPIGatewayInvokeChangePassword"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.change_password.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "cancel_event_apigw" {
  statement_id  = "AllowAPIGatewayInvokeCancelEvent"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cancel_event.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "cancel_booking_apigw" {
  statement_id  = "AllowAPIGatewayInvokeCancelBooking"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cancel_booking.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "my_events_apigw" {
  statement_id  = "AllowAPIGatewayInvokeMyEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.my_events.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "my_bookings_apigw" {
  statement_id  = "AllowAPIGatewayInvokeMyBookings"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.my_bookings.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

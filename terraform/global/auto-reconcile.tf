# Auto-reconcile when Azure recovers. Route 53 health check for Azure goes
# ALARM while it's down and OK when it recovers; the OK transition triggers
# a Lambda (via SNS) that calls the AWS reconcile endpoint, so AWS pushes any
# writes Azure missed while it was down.

# --- IAM role for the trigger Lambda ---
resource "aws_iam_role" "reconcile_trigger" {
  name = "${var.record_name}-reconcile-trigger-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "reconcile_trigger_basic" {
  role       = aws_iam_role.reconcile_trigger.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- trigger Lambda: calls the reconcile endpoint over HTTPS ---
data "archive_file" "reconcile_trigger" {
  type        = "zip"
  output_path = "${path.module}/reconcile-trigger.zip"

  source {
    filename = "index.js"
    content  = <<-JS
      // Called by SNS when Azure recovers. Hits the AWS reconcile endpoint.
      // Azure may answer /health before it can accept writes, so retry with
      // a backoff until the sync reports no failures.
      const https = require('https');

      const MAX_ATTEMPTS = 4;
      const BACKOFF_MS = 30000;

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      function callReconcile() {
        const url = new URL(process.env.RECONCILE_URL);
        const body = JSON.stringify({ trigger: 'azure-recovery' });
        const options = {
          method: 'POST',
          hostname: url.hostname,
          path: url.pathname,
          headers: {
            'Content-Type': 'application/json',
            'x-replication-key': process.env.REPLICATION_SECRET,
            'Content-Length': Buffer.byteLength(body),
          },
        };
        return new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
          });
          req.on('error', reject);
          req.write(body);
          req.end();
        });
      }

      exports.handler = async () => {
        let last;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          last = await callReconcile();

          let failed = null;
          try {
            failed = JSON.parse(last.body).synced.failed;
          } catch (e) {
            // unparseable body - treat as a failure worth retrying
          }

          console.log(
            'reconcile attempt ' + attempt + '/' + MAX_ATTEMPTS + ':',
            last.status,
            last.body
          );

          if (last.status === 200 && failed === 0) {
            return { attempts: attempt, ...last };
          }
          if (attempt < MAX_ATTEMPTS) {
            await sleep(BACKOFF_MS);
          }
        }
        console.log('reconcile did not reach failed:0 after all attempts');
        return { attempts: MAX_ATTEMPTS, ...last };
      };
    JS
  }
}

resource "aws_lambda_function" "reconcile_trigger" {
  function_name    = "${var.record_name}-reconcile-trigger"
  filename         = data.archive_file.reconcile_trigger.output_path
  source_code_hash = data.archive_file.reconcile_trigger.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.reconcile_trigger.arn
  timeout          = 300

  environment {
    variables = {
      RECONCILE_URL      = "https://${var.aws_api_domain}/replicate/reconcile"
      REPLICATION_SECRET = var.replication_secret
    }
  }
}

# --- SNS topic linking the alarm to the trigger Lambda ---
resource "aws_sns_topic" "azure_recovery" {
  name = "${var.record_name}-azure-recovery"
}

resource "aws_sns_topic_subscription" "azure_recovery" {
  topic_arn = aws_sns_topic.azure_recovery.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.reconcile_trigger.arn
}

resource "aws_lambda_permission" "allow_sns" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reconcile_trigger.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.azure_recovery.arn
}

# --- CloudWatch alarm on the Azure health check ---
# HealthCheckStatus is 1 when healthy, 0 when down. Notify on the OK
# transition (recovery); 3 healthy periods are required to avoid flapping.
resource "aws_cloudwatch_metric_alarm" "azure_down" {
  alarm_name          = "${var.record_name}-azure-endpoint-down"
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.azure_endpoint.id }
  statistic           = "Minimum"
  period              = 30
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  # fire the trigger when the alarm clears (Azure recovered)
  ok_actions = [aws_sns_topic.azure_recovery.arn]

  alarm_description = "Azure endpoint health; OK transition triggers reconcile from AWS."
}

output "reconcile_trigger_function" {
  description = "Name of the Lambda that auto-triggers reconcile on Azure recovery"
  value       = aws_lambda_function.reconcile_trigger.function_name
}

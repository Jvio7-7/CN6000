# Gather — event booking, multi-cloud

Event booking app for CN6000. Same app deployed on AWS and Azure at the
same time (Active/Active), with data replicated between them and Route 53
handling failover if one side goes down.

Stack:
- Frontend: Next.js (static export), hosted on S3+CloudFront (AWS) and
  Storage static website (Azure)
- Backend: Lambda + API Gateway (AWS), Azure Functions (Azure)
- DB: RDS PostgreSQL (AWS), Azure SQL Database (Azure)
- IaC: Terraform
- Auth: custom JWT, not Azure AD (see below for why)

Repo: github.com/Jvio7-7/CN6000

## Local dev

The frontend has no backend of its own — it calls whichever cloud you
point it at. So local dev just means running the Next.js dev server
against an already-deployed backend:

```powershell
npm install
copy .env.example .env.local
# set NEXT_PUBLIC_API_BASE_URL in .env.local
npm run dev
```

## Deploying AWS backend

Lambda functions + API Gateway + RDS.

```powershell
cd terraform\aws
copy terraform.tfvars.example terraform.tfvars
# fill in db_password, azure_base_url, jwt_secret
terraform init
terraform apply
```

Then build and push the Lambda code:
```powershell
cd ..\..
.\build-lambda.ps1
cd terraform\aws
terraform apply
```

Run the schema on RDS:
```powershell
psql -h <rds_endpoint> -U eventappadmin -d eventdb -f ..\..\sql\schema-postgres.sql
```

## Deploying Azure backend

Azure Functions + Azure SQL.

```powershell
cd terraform\azure
copy terraform.tfvars.example terraform.tfvars
# fill in subscription_id, sql_admin_password, aws_base_url, jwt_secret
terraform init
terraform apply
```

Publish the function code:
```powershell
cd ..\..\azure-functions
npm install
func azure functionapp publish <function_app_name> --javascript
```

Run the schema on Azure SQL:
```powershell
sqlcmd -S <sql_server_fqdn> -d eventdb -U eventappadmin -P <password> -i sql\schema-mssql.sql
```

**Azure region note:** the student subscription only allows deployment to
a handful of regions (found by trial and error — most regions come back
with a vague "disallowed by Azure" error). Currently using
`southeastasia`, paired with AWS `ap-southeast-1` so the two clouds are
geographically close for a fair latency comparison later.

**Node version:** AWS Lambda runs Node 22. Azure Functions is stuck on
Node 20 — the Terraform azurerm provider (v3.x) doesn't support
declaring Node 22 for Function Apps yet, only the newer v4 provider does,
and switching providers mid-project felt riskier than it was worth.

## Route 53 (Active/Active routing)

```powershell
cd terraform\global
terraform init
terraform apply
```

This sets up a hosted zone, health checks on both `/health` endpoints,
and weighted DNS (50/50) between AWS and Azure. No real domain was
bought for this — the zone isn't publicly delegated, so it's tested by
querying the assigned name servers directly:

```powershell
Resolve-DnsName -Name api.cn6000-jin-fyp.com -Type CNAME -Server <one of the name servers>
```

## Data replication

Every write (event, booking, payment, user) generates a UUID and gets
pushed to the other cloud right after the local write succeeds. UUIDs
instead of auto-increment IDs because two clouds writing independently
would eventually generate the same integer ID for different rows.

Replication is awaited, not fire-and-forget — Lambda freezes its
execution environment as soon as the handler returns, so an unawaited
background request just gets killed. Found this the hard way when
replication silently did nothing for a while.

## Password reset

Request a code → it shows up as a notification (there's no real email
sending set up, see below) → enter the code + new password.

## Why not Azure AD

The plan was to use Azure AD, but the university tenant blocks students
from registering applications, which Azure AD login needs. Built a
custom JWT system instead — same secret on both clouds, so a login on
AWS works when checking `/users/me` on Azure and vice versa.

## Payments

Fake. No real processor. Card ending in `0000` = declined, anything else
= success, same convention Stripe uses for test cards.

## Notifications

Also fake — no email/SMS provider. Booking and payment both trigger a
notification row instead of an actual email. Not replicated across
clouds (unlike everything else) since it's just a log of what happened
locally, not something both sides need to agree on.

## Deploying the frontend publicly

```powershell
cd terraform\frontend-aws
terraform init
terraform apply

cd ..\frontend-azure
copy terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

Then build and push:
```powershell
cd ..\..
.\deploy-frontend-aws.ps1 -BucketName <bucket_name> -DistributionId <cloudfront_distribution_id>
.\deploy-frontend-azure.ps1 -StorageAccountName <storage_account_name>
```

No CDN on the Azure side — tried to set one up but Azure stopped
allowing new classic CDN profiles, and the replacement (Front Door) costs
~$35/month, which isn't worth it since Azure's static website endpoint
already does HTTPS on its own. S3 needed CloudFront because S3's website
endpoint is HTTP only.

Two separate URLs, not one unified domain — would need an actual
purchased domain to make one address fail over between them, which
wasn't worth it for this.

## Security notes

RDS is publicly accessible with the security group open on 5432 — avoids
putting Lambda in a VPC (needs a NAT gateway, extra cost). Azure SQL's
firewall allows Azure services generally plus whatever IP I'm currently
on.

## Tearing everything down

```powershell
cd terraform\frontend-azure
terraform destroy
cd ..\frontend-aws
terraform destroy
cd ..\global
terraform destroy
cd ..\aws
terraform destroy
cd ..\azure
terraform destroy
```

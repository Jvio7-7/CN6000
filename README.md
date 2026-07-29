# Gather - event booking, multi-cloud

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

The frontend has no backend of its own - it calls whichever cloud you
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

**Azure region note:** the student subscription only allows a handful of
regions. Using `southeastasia`, paired with AWS `ap-southeast-1` so the two
clouds are geographically close for a fair latency comparison.

**Node version:** both clouds run Node 22. Azure needed the azurerm v4
provider to declare Node 22 on Function Apps (v3 only went up to Node 20),
so this project uses v4.

## Deploying: accounts, cancellation, and password reset

New `user_id`/`cancelled_at` columns on events and bookings, plus
`security_question`/`security_answer_hash` on users (replacing the
email-based verification/reset this went through earlier - see "Why not
email verification" below for why). No SES, no email service, no
external account setup needed at all this time - just code and schema.

**Step A - rebuild and redeploy AWS:**
```powershell
.\build-lambda.ps1
cd terraform\aws
terraform apply
```

**Step B - republish Azure:**
```powershell
cd ..\..\azure-functions
npm install
func azure functionapp publish <function_app_name> --javascript
```

**Step C - reset both schemas** (new columns, easiest to just wipe and
start over, same as every previous schema change):
```powershell
cd ..
psql -h <rds_endpoint> -U eventappadmin -d eventdb -f sql\schema-postgres.sql
sqlcmd -S <sql_server_fqdn> -d eventdb -U eventappadmin -P <password> -i sql\schema-mssql.sql
```

**Step D - rebuild and redeploy the frontend** (event creation and
booking now require login, and register/login/forgot-password all
changed):
```powershell
.\deploy-frontend-aws.ps1 -BucketName <bucket_name> -DistributionId <cloudfront_distribution_id>
.\deploy-frontend-azure.ps1 -StorageAccountName <storage_account_name>
```

## Event and booking rules

A batch of real business rules, not just UI polish:

- Event time uses a native time input (5-minute step) and can't be set
  in the past - checked client-side and again server-side
- Past events fold into a collapsible "Old events" section on the
  homepage instead of disappearing or cluttering the main list
- Hosting an event now sets a price upfront - attendees pay that exact
  amount, no separate amount field on the payment page
- A participant can't book the same event twice (checked server-side
  before the insert) or book into a full event (checked against a live
  count of non-cancelled bookings, not a stored counter)
- Name/email on the booking form come from the logged-in account and
  aren't editable there - a booking should always reflect who actually
  made it
- Cancelling an event cascades: every active booking against it gets
  cancelled too, and anyone with a completed payment gets a (simulated)
  refund notification. Cancelling your own paid booking sends the same
  kind of notification. Neither is a real refund (no real payment
  processor), just a notification row.

No new Terraform resources for any of this - it's all logic inside
Lambda functions and Azure Functions that already existed. AWS still
needs its usual `terraform apply` (it's what actually pushes the
rebuilt Lambda code - Terraform notices the zip's hash changed), but
Azure skips it entirely and goes straight to a republish:

```powershell
.\build-lambda.ps1
cd terraform\aws
terraform apply
```
```powershell
cd ..\..\azure-functions
func azure functionapp publish <function_app_name> --javascript
```
```powershell
cd ..
psql -h <rds_endpoint> -U eventappadmin -d eventdb -f sql\schema-postgres.sql
sqlcmd -S <sql_server_fqdn> -d eventdb -U eventappadmin -P <password> -i sql\schema-mssql.sql
```
```powershell
.\deploy-frontend-aws.ps1 -BucketName <bucket_name> -DistributionId <cloudfront_distribution_id>
.\deploy-frontend-azure.ps1 -StorageAccountName <storage_account_name>
```

## DNS and Active/Active routing

The domain `gather-up.info` is registered (through IONOS) and delegated,
so `www.gather-up.info` (frontend) and `api.gather-up.info` (API) resolve
publicly.

```powershell
cd terraform\global
terraform init
terraform apply
```

`global` sets up the Route 53 hosted zone, health checks on both `/health`
endpoints, and weighted DNS (50/50) between AWS and Azure.

To avoid Route 53 itself being a single point of failure, DNS is served by
two providers at once: Route 53 and Azure DNS, with the registrar
delegating to name servers from both. Azure DNS (`terraform\azure-dns`)
mirrors the zone, and a Traffic Manager profile (`terraform\traffic-manager`)
does the weighted 50/50 on the Azure side. Both planes are compared in the
RTO measurement.

Azure DNS keeps its four system name servers on the zone apex and won't let
them be removed, so the apex NS set isn't a clean 2+2 split - harmless here
since every name server answers the api records correctly.

## Data replication

Every write (event, booking, payment, user) generates a UUID and gets
pushed to the other cloud right after the local write succeeds. UUIDs
instead of auto-increment IDs because two clouds writing independently
would eventually generate the same integer ID for different rows.

Replication is awaited, not fire-and-forget - Lambda freezes the
execution environment once the handler returns, so an unawaited
background request gets killed before it finishes.

## Why not email verification

Tried this twice, actually - a full email-verification-at-signup flow
plus a 6-digit-code password reset, both via AWS SES. Removed both and
replaced them with a security question set at signup instead. The
reason is a hard platform limit, not a change of taste: SES starts in
sandbox mode, which only sends to individually *verified* recipient
addresses, and as of 2024 AWS requires a domain with SPF/DKIM/DMARC DNS
records configured before it will even consider lifting that
restriction. Getting SES out of sandbox (domain identity, SPF/DKIM/DMARC,
a production-access request) was more setup than this project needed just
for signup email, so it only ever sent to a handful of manually verified
addresses - which doesn't scale to "works for anyone who signs up".

Security questions need no external service at all: the registrant
writes their own question and answer at signup (`security_question` is
plain text, `security_answer_hash` is bcrypt-hashed the same way a
password is), and resetting a password means answering it correctly.
Both signup and login work immediately again, no verification step
in between.

## Password reset (security question)

Enter your email and the account's security question comes back. Answer
it correctly and set a new password on the same page. If no account matches
the email, the page says so directly rather than the usual "if an account
exists we've sent a link" - clearer to demo, though a production app would
hide it to avoid revealing which emails are registered.

The answer is compared case-insensitively and trimmed, so "Blue" and
"blue " both match what was set at signup.

## Password policy

12-24 characters, with at least one uppercase, one lowercase, one number,
and one special character. Checked client-side for feedback
(`lib/validation.ts`) and again server-side in `auth.js` on both clouds.
The same check runs on registration, reset, and change.

## Accounts: profile edit, password change, and ownership

Logged-in users can change their name and password from the account
page (password change requires the current password, unlike the
code-based reset flow above). Hosting an event or booking a slot
requires being logged in, since "your events" and "your bookings" are
tied to the authenticated user.

Cancelling an event or booking is a soft delete (a `cancelled_at`
timestamp), not a real DELETE - a hard delete would violate the foreign
keys bookings/payments already have against events. Cancelled events
drop off the public listing but the row (and its history) stays.

Event/booking replication uses an upsert (the same pattern used for
user records): a cancellation on one cloud *updates* the existing row on
the other cloud, rather than being silently skipped because the id
already exists.

## Why not Azure AD

The plan was to use Azure AD, but the university tenant blocks students
from registering applications, which Azure AD login needs. Built a
custom JWT system instead - same secret on both clouds, so a login on
AWS works when checking `/users/me` on Azure and vice versa.

## Payments

Fake. No real processor. Card ending in `0000` = declined, anything else
= success, same convention Stripe uses for test cards.

## Notifications

Also fake - no email/SMS provider. Booking and payment both trigger a
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

No CDN on the Azure side: Front Door is blocked on the student account,
and the static website endpoint already serves HTTPS on its own. S3 needs
CloudFront because the S3 website endpoint is HTTP only.

S3 auto-resolves an extensionless URL like `/account` to `account.html`,
but Azure Storage's static website doesn't. `next.config.js` sets
`trailingSlash: true` so Next.js exports `account/index.html`, which both
clouds resolve the same way.

## Security notes

RDS isn't publicly accessible - it sits in private subnets, and the Lambdas
run inside the VPC to reach it, with a NAT gateway for their outbound calls
(replication to the other cloud). Azure SQL's firewall allows Azure services
plus whatever IP I'm currently on.

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

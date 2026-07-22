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

**Azure region note:** the student subscription only allows deployment to
a handful of regions (found by trial and error - most regions come back
with a vague "disallowed by Azure" error). Currently using
`southeastasia`, paired with AWS `ap-southeast-1` so the two clouds are
geographically close for a fair latency comparison later.

**Node version:** both clouds now run Node 22. Azure was stuck on Node
20 for a while - the Terraform azurerm provider (v3.x) didn't support
declaring Node 22 for Function Apps, only the newer v4 provider did, and
switching providers mid-project felt riskier than it was worth at the
time. Revisited it once Azure started warning that Node 20 had reached
end-of-life: checked the official v3 to v4 upgrade guide against every
resource this project actually uses (storage account, Function App, SQL
server/database/firewall rules), and none of the breaking changes in
that guide touched anything used here - the only real changes needed
were the provider version itself, one deprecated provider-level setting,
and the `node_version` value. Worth checking the actual upgrade guide
against your specific resources before assuming a major version bump is
riskier than it is; in this case it wasn't.

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

- Event times snap to 5-minute steps and can't be set in the past
  (`step`/`min` on the date input client-side, and the same "must be in
  the future" check server-side too - client-side alone isn't real
  enforcement)
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
  kind of notification. Neither is a real refund - there's no real
  payment processor anywhere in this project - but the notification
  trail is genuine.

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

## Route 53 (Active/Active routing)

```powershell
cd terraform\global
terraform init
terraform apply
```

This sets up a hosted zone, health checks on both `/health` endpoints,
and weighted DNS (50/50) between AWS and Azure. No real domain was
bought for this - the zone isn't publicly delegated, so it's tested by
querying the assigned name servers directly:

```powershell
Resolve-DnsName -Name api.cn6000-jin-fyp.com -Type CNAME -Server <one of the name servers>
```

## Data replication

Every write (event, booking, payment, user) generates a UUID and gets
pushed to the other cloud right after the local write succeeds. UUIDs
instead of auto-increment IDs because two clouds writing independently
would eventually generate the same integer ID for different rows.

Replication is awaited, not fire-and-forget - Lambda freezes its
execution environment as soon as the handler returns, so an unawaited
background request just gets killed. Found this the hard way when
replication silently did nothing for a while.

## Why not email verification

Tried this twice, actually - a full email-verification-at-signup flow
plus a 6-digit-code password reset, both via AWS SES. Removed both and
replaced them with a security question set at signup instead. The
reason is a hard platform limit, not a change of taste: SES starts in
sandbox mode, which only sends to individually *verified* recipient
addresses, and as of 2024 AWS requires a domain with SPF/DKIM/DMARC DNS
records configured before it will even consider lifting that
restriction. This project deliberately never bought a domain (same
reason Route 53 uses an undelegated zone), so real email delivery to
arbitrary registered users was never actually achievable here - only to
whichever handful of addresses got manually verified one at a time. That
doesn't scale to "works for anyone who signs up," which is the actual
bar for a real account system.

Security questions need no external service at all: the registrant
writes their own question and answer at signup (`security_question` is
plain text, `security_answer_hash` is bcrypt-hashed the same way a
password is), and resetting a password means answering it correctly.
Both signup and login work immediately again, no verification step
in between.

## Password reset (security question)

Enter your email and the account's security question comes back. Answer
it correctly and you can set a new password, all on the same page. One
thing to flag: if there's no account for that email, the page says so
outright instead of the usual vague "if an account exists we've sent
you a link". That makes it easy to check whether an email is
registered, which a real product wouldn't want, but it keeps the flow
much clearer to use and to demo.
The answer is compared case-insensitively and trimmed, so "Blue" and
"blue " both match what was set at signup - this isn't a
high-security context, being forgiving matters more than exactness.

## Password policy

12-24 characters, at least one uppercase letter, one lowercase letter,
one number, and one special character. Enforced in both places that
matter: client-side for immediate feedback (`lib/validation.ts`), and
server-side in `auth.js` on both clouds, since client-side alone isn't
real enforcement - the same check runs on registration, password reset,
and password change alike, so there's no path that skips it.

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

No CDN on the Azure side - tried to set one up but Azure stopped
allowing new classic CDN profiles, and the replacement (Front Door) costs
~$35/month, which isn't worth it since Azure's static website endpoint
already does HTTPS on its own. S3 needed CloudFront because S3's website
endpoint is HTTP only.

Two separate URLs, not one unified domain - would need an actual
purchased domain to make one address fail over between them, which
wasn't worth it for this.

**Another real platform difference, found the hard way:** S3's website
hosting auto-resolves an extensionless URL like `/account` to
`account.html`. Azure Storage's static website feature has never added
that (a genuine, still-open gap - people have been asking Microsoft
about it for years). `next.config.js` uses `trailingSlash: true` so
Next.js exports `account/index.html` instead - both platforms agree on
resolving `index.html` inside a folder-style path, so this works
identically on both clouds rather than depending on an AWS-only
convenience. Found this by clicking a direct link on the Azure-hosted
site and getting a 404 that the AWS-hosted site never showed.

## Security notes

RDS is publicly accessible with the security group open on 5432 - avoids
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

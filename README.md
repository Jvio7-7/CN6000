# Event Booking App

Minimal event booking system with two REST endpoints:
- `POST /events` — create an event
- `POST /bookings` — book a slot at an event

Two things live in this repo:

1. **`app/`, `lib/`** — a Next.js app used purely for local development and
   testing against Docker Postgres. This is NOT what gets deployed to AWS.
2. **`lambda/`, `terraform/aws/`** — the actual AWS deployment: two Lambda
   functions behind API Gateway, talking to RDS PostgreSQL. This is the
   proposal-faithful "serverless" implementation.

Azure's equivalent (Azure Functions + Azure SQL Database) will mirror the
`lambda/` structure once we get there — same two endpoints, same schema.

## 1. Local testing first (before touching the cloud)

Requires Docker Desktop running.

```powershell
# start a local Postgres container
docker-compose up -d

# create the tables
Get-Content sql\schema-postgres.sql | docker exec -i event-app-postgres-1 psql -U user -d eventdb

# install dependencies
npm install

# copy env template (already points at local Docker Postgres)
copy .env.example .env.local

# run the dev server
npm run dev
```

Test with PowerShell's `Invoke-RestMethod` (not `curl` — that's aliased to
`Invoke-WebRequest` on Windows and handles quotes differently):

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/events -Method Post -ContentType "application/json" -Body '{"title":"CN6000 Demo Day","date":"2026-08-01T10:00:00Z","location":"LSBF Singapore","capacity":50}'

Invoke-RestMethod -Uri http://localhost:3000/api/bookings -Method Post -ContentType "application/json" -Body '{"eventId":1,"attendeeName":"Jin","attendeeEmail":"jin@example.com"}'
```

## 2. Deploying to AWS (Lambda + API Gateway + RDS)

The `lambda/` folder holds the actual AWS handlers — plain Node.js, no
Next.js involved. `terraform/aws/` provisions the infrastructure.

**Step A — build the Lambda deployment packages:**

```powershell
.\build-lambda.ps1
```

This installs `pg` into `lambda/layer/nodejs/`, then zips the layer and
both function folders into `lambda/layer.zip`, `lambda/events.zip`, and
`lambda/bookings.zip`. Terraform references these zip files directly.

**Step B — set your DB password:**

```powershell
cd terraform\aws
copy terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` and set a real password (8+ characters). This file
is gitignored — never commit it.

**Step C — deploy:**

```powershell
terraform init
terraform plan
terraform apply
```

Review the plan, type `yes` to confirm. This creates the RDS instance
(takes a few minutes), the Lambda functions, the layer, and API Gateway.

**Step D — create the tables on RDS:**

Once `terraform apply` finishes, it prints `rds_endpoint`. Connect using
that address (e.g. with `psql` or a GUI tool like pgAdmin/DBeaver) and run
`sql/schema-postgres.sql` against it — same schema as local, just against
the real RDS instance.

**Step E — test the deployed API:**

`terraform apply` also prints `api_endpoint`. Test it the same way as
local, just swap the URL:

```powershell
Invoke-RestMethod -Uri "<api_endpoint>/events" -Method Post -ContentType "application/json" -Body '{"title":"CN6000 Demo Day","date":"2026-08-01T10:00:00Z","location":"LSBF Singapore","capacity":50}'
```

## 3. Deploying to Azure (Functions + Azure SQL Database)

The `azure-functions/` folder holds the Azure-side handlers, written with
the Azure Functions v4 programming model — structurally close to the
Lambda handlers (same routes, same request/response shape), just using
`mssql` instead of `pg`. `terraform/azure/` provisions the infrastructure.

**Step A — install Azure Functions Core Tools** (needed to publish the
function code — Terraform provisions the infrastructure, but code
deployment for Functions is normally done through this tool):

```powershell
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

**Step B — set your SQL admin password:**

```powershell
cd terraform\azure
copy terraform.tfvars.example terraform.tfvars
notepad terraform.tfvars
```

The `subscription_id` is already filled in from your `az account show`
output. Set a real `sql_admin_password` (8+ characters, avoid `/`, `@`,
`"`, and spaces — same rule as the AWS RDS password).

**Step C — deploy the infrastructure:**

```powershell
terraform init
terraform plan
terraform apply
```

Type `yes` to confirm. This creates the resource group, storage account,
Consumption plan, Function App, and Azure SQL Server/Database — a couple
of minutes, faster than RDS was.

**Step D — create the tables on Azure SQL:**

Terraform prints `sql_server_fqdn` when done. Connect with `sqlcmd`
(installs alongside the same PostgreSQL/SQL client tooling, or via
`winget install -e --id Microsoft.SqlServer.CmdLineUtils`) and run
`sql/schema-mssql.sql` against it — mirrors what we did with `psql` on
the AWS side.

**Step E — publish the function code:**

```powershell
cd ..\..\azure-functions
func azure functionapp publish <function_app_name>
```

(`<function_app_name>` is the `function_app_name` output from Step C.)
This uploads and deploys the actual JavaScript — Terraform never touches
your function code directly, only the infrastructure around it.

**Step F — test the deployed API:**

```powershell
Invoke-RestMethod -Uri "<function_app_url>/api/events" -Method Post -ContentType "application/json" -Body '{"title":"CN6000 Demo Day","date":"2026-08-01T10:00:00Z","location":"LSBF Singapore","capacity":50}'
```

Note the `/api/` prefix — Azure Functions HTTP triggers are namespaced
under `/api/` by default, unlike the AWS API Gateway routes which were
bare `/events` and `/bookings`. Worth flagging in your report as one of
the small but real API-shape differences between the two clouds.

## 4. Cross-cloud routing (Route 53 Active/Active failover)

This ties both clouds into one system, using Route 53 as a single global
routing layer that health-checks both AWS and Azure and automatically
shifts traffic away from whichever one is unhealthy.

**Step A — deploy the new `/health` endpoints:**

AWS side (rebuild the Lambda zips to pick up the new health function,
then re-apply):
```powershell
cd C:\Users\Jvio77\Desktop\event-app
.\build-lambda.ps1
cd terraform\aws
terraform apply
```

Azure side (the v4 programming model auto-discovers the new
`health.js` file, just needs a re-publish):
```powershell
cd ..\..\azure-functions
func azure functionapp publish <function_app_name> --javascript
```

**Step B — confirm both health endpoints work before wiring up Route 53:**
```powershell
Invoke-RestMethod -Uri "<api_endpoint>/health"
Invoke-RestMethod -Uri "<function_app_url>/api/health"
```
Both should return `{"status":"ok","cloud":"aws"}` / `{"status":"ok","cloud":"azure"}`.
If either fails, fix that before moving on — Route 53 health checks won't
make sense against a broken endpoint.

**Step C — deploy the Route 53 layer:**
```powershell
cd ..\terraform\global
terraform init
terraform apply
```
Type `yes`. This creates the hosted zone, two health checks (one per
cloud), and two weighted CNAME records (50/50 split).

**Step D — no domain needed.** Since this project doesn't use a
registered/purchased domain, the hosted zone isn't publicly delegated.
Instead, query Route 53's own name servers directly — this is a
completely valid way to test failover behaviour, and arguably cleaner
for the RTO experiment since it isolates Route 53's own failover logic
from public DNS caching effects elsewhere in the resolution chain.

Terraform prints `name_servers` and `record_fqdn` when done. Test
resolution like this:
```powershell
Resolve-DnsName -Name <record_fqdn> -Type CNAME -Server <one_of_the_name_servers>
```
Run it a few times — you should see it return either the AWS or Azure
CNAME roughly 50/50, confirming the weighted Active/Active split is
working.

**Step E — health check propagation takes a few minutes.** Route 53
health checks need a little time after creation before they've actually
run enough checks to report a status. Give it 2-3 minutes, then check:
```powershell
aws route53 get-health-check-status --health-check-id <aws_health_check_id>
aws route53 get-health-check-status --health-check-id <azure_health_check_id>
```
Both should eventually show `Success`.

Failover testing itself (deliberately breaking one cloud's health check
and timing how long Route 53 takes to stop returning it) is Phase 6 —
that's literally the RTO measurement.

## 5. Cross-cloud data replication (dual-write, UUID-keyed)

Route 53 (section 4) makes both clouds reachable under one system and
automatically routes around outages — but it doesn't sync **data**. Until
now, AWS and Azure each had a completely independent database: a booking
made via AWS was invisible to Azure, and vice versa. This section closes
that gap.

**How it works:** every write generates a UUID (not an auto-increment
integer — two independent clouds generating their own `1, 2, 3...` would
eventually collide). The write goes to the local database first, then a
best-effort HTTP call replicates the same record to the other cloud. The
local write always succeeds and returns to the user immediately, even if
replication fails — this is deliberate: an unreachable replica (e.g.
during a simulated outage) should never block or fail the primary write.
Whatever didn't make it across before a failure is exactly the data-loss
window Phase 6's RPO measurement is about.

**Step A — update both tfvars files with each other's URLs:**

In `terraform\aws\terraform.tfvars`, add:
```hcl
azure_base_url = "<your function_app_url>/api"
```

In `terraform\azure\terraform.tfvars`, add:
```hcl
aws_base_url = "<your api_endpoint>"
```

**Step B — rebuild and redeploy AWS** (adds two new Lambda functions:
`replicate-events`, `replicate-bookings`, plus wires `AZURE_BASE_URL`
into the existing functions):
```powershell
cd C:\Users\Jvio77\Desktop\event-app
.\build-lambda.ps1
cd terraform\aws
terraform apply
```

**Step C — redeploy Azure infrastructure** (adds `AWS_BASE_URL` app
setting):
```powershell
cd ..\azure
terraform apply
```

**Step D — reset both databases.** The schema changed (UUID primary keys
instead of auto-increment integers), so existing tables need to be
dropped and recreated — this wipes any test data from earlier phases,
which is expected:
```powershell
# AWS RDS
cd ..\aws
$env:PGPASSWORD="<your db password>"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h <rds_endpoint> -U eventappadmin -d eventdb -f ..\..\sql\schema-postgres.sql

# Azure SQL
cd ..\..\
sqlcmd -S <sql_server_fqdn> -d eventdb -U eventappadmin -P "<your sql password>" -i sql\schema-mssql.sql
```

**Step E — republish the Azure Functions code** (picks up the rewritten
`db.js` plus the two new `replicateEvent`/`replicateBooking` functions):
```powershell
cd azure-functions
func azure functionapp publish <function_app_name> --javascript
```

**Step F — test replication in both directions.** Create an event on
AWS, then check it shows up on Azure's database (and vice versa):
```powershell
# create on AWS
Invoke-RestMethod -Uri "<api_endpoint>/events" -Method Post -ContentType "application/json" -Body '{"title":"Replication Test","date":"2026-08-01T10:00:00Z","location":"Test","capacity":10}'

# wait a couple seconds for replication, then query Azure directly
sqlcmd -S <sql_server_fqdn> -d eventdb -U eventappadmin -P "<your sql password>" -Q "SELECT id, title, origin_cloud FROM events"
```
You should see the event with `origin_cloud = aws` present in the Azure
database too — proof the replication call worked, not just the local
write.

## 6. Security note (for the report)

RDS is set to `publicly_accessible = true` with inbound open on port 5432.
This is intentional for coursework simplicity — it avoids putting Lambda in
a VPC (which would need a NAT Gateway, adding cost and complexity). In a
production deployment, RDS would sit in a private subnet reachable only
from Lambda's own security group.

On the Azure side, the SQL Server firewall allows Azure services generally
(since the Consumption-plan Function App has no fixed outbound IP) plus
your own machine's current IP for direct schema access. Same underlying
tradeoff as the AWS side, different mechanism — both worth a sentence or
two in your Design or Testing chapter.

## 7. Tearing down (to avoid burning through credits)

When you're done experimenting for the day:

```powershell
cd terraform\global
terraform destroy

cd ..\aws
terraform destroy

cd ..\azure
terraform destroy
```

Re-run `terraform apply` (and re-publish the Azure function code) next
time you need it back up.

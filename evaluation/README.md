# Evaluation scripts

Scripts used to measure the platform for the report. Not part of the app -
nothing here is deployed, they just call the public APIs from a laptop.

Run them from this folder. PowerShell blocks downloaded scripts, so
`Unblock-File .\<script>.ps1` first if it complains.

## Failover (RTO)

    .\measure-rto.ps1

Polls the Route 53 health checks and the weighted DNS answer once a second
and writes `rto-log-<timestamp>.csv`. Kill a cloud in another window while
it runs:

    az functionapp stop  -g eventapp-rg -n eventapp-func-zhw36q
    az functionapp start -g eventapp-rg -n eventapp-func-zhw36q

RTO is read off the log: the row where the healthy-checker count starts
dropping is roughly when the cloud died, and the row where the DNS share
hits 0 is when it stopped being routed to. A real browser adds up to the
record TTL (30s) on top of that.

## Data loss (RPO)

    .\measure-rpo.ps1
    .\verify-rpo.ps1 -RunId <tag printed above> -LastSeq <last seq>

`measure-rpo` registers a user every second against one cloud while the
other is down. `verify-rpo` then tries to log in as each of those users on
both clouds - 200 means the user is there, 401 means it never replicated.
The 401s are the RPO loss.

To show the reconcile endpoint fixing it, call it and re-run verify:

    curl -Method POST "<aws api>/replicate/reconcile" -UseBasicParsing

## Load test

    k6 run -e BASE=<cloud api url> -e RUN=aws-run1 loadtest.js

Ramps virtual users against /health and /users/register. Run once per cloud
and compare latency (especially p95) and throughput.

## End to end

    .\integration-test.ps1 -Target aws
    .\integration-test.ps1 -Target azure

Full user journey plus the business rules, and checks the records show up
on the other cloud. Prints PASS/FAIL per check.

## Cleaning up afterwards

These create real rows in both databases. Emails are tagged (`rpo-`,
`load-`, `e2e-`) so they are easy to find. Delete child rows before users
or the foreign keys block it:

    DELETE FROM notifications WHERE recipient_email LIKE 'e2e-%';
    DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE attendee_email LIKE 'e2e-%');
    DELETE FROM bookings WHERE attendee_email LIKE 'e2e-%';
    DELETE FROM events WHERE title LIKE 'e2e-%';
    DELETE FROM users WHERE email LIKE 'e2e-%';

Run it on both clouds. The rpo/load scripts only create users, so for those
the last line on its own is enough.

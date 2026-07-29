# Evaluation scripts

Scripts used to measure the platform for the report. Not part of the app -
nothing here is deployed, they just call the public APIs from a laptop.

Run them from this folder. PowerShell blocks downloaded scripts, so run
`Unblock-File .\<script>.ps1` first if it complains.

## Failover and failback (RTO)

    .\RTO\four-cell-rto-measurement.ps1

Measures failover across two DNS control planes and two kill directions at
once, so one AWS kill covers cells 1+3 and one Azure kill covers 2+4:

              | aws kill | azure kill
    ----------+----------+-----------
    route53   |  cell 1  |  cell 2
    tm        |  cell 3  |  cell 4

The route53 plane queries `api.gather-up.info` straight at a Route 53 name
server; the tm plane queries the Traffic Manager name at its own
authoritative servers, so neither goes through a caching resolver. The
script kills a cloud, waits for the DNS answer to drop it, then restores it
and times the failback too. It auto-restores between trials, so don't
ctrl+c mid-run. Results go to `four-cell-rto-result.csv`.

## Data loss (RPO)

    .\RPO\measure-rpo.ps1

Runs both directions in one go. For each direction it registers a user every
second against the surviving cloud, kills the other one partway, brings it
back, and counts who didn't replicate. Two numbers per direction: the raw
loss right after restore (before auto-reconcile fires), and the loss after a
manual reconcile, which should be 0.

Writes three files: a summary, a per-user register log, and a per-user verify
log (so each lost user is traceable).

## Load test

    k6 run -e BASE=<cloud api url> -e RUN=aws-run1 loadtest.js

Ramps virtual users against `/health` and `/users/register`. Run once per
cloud and compare latency (especially p95) and throughput.

## End to end

    .\integration-test\integration-test.ps1 -Target aws
    .\integration-test\integration-test.ps1 -Target azure

Runs the main user journey (register, login, host an event, book, pay,
cancel) plus the business rules, and checks the records show up on the other
cloud. Prints PASS/FAIL per check. It covers the core journey rather than
every route.

## Cleaning up afterwards

These create real rows in both databases. Emails are tagged (`rpo-`,
`load-`, `e2e-`) so they're easy to find. Delete child rows before users or
the foreign keys block it:

    DELETE FROM notifications WHERE recipient_email LIKE 'e2e-%';
    DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE attendee_email LIKE 'e2e-%');
    DELETE FROM bookings WHERE attendee_email LIKE 'e2e-%';
    DELETE FROM events WHERE title LIKE 'e2e-%';
    DELETE FROM users WHERE email LIKE 'e2e-%';

Run it on both clouds. The rpo/load scripts only create users, so the last
line on its own is enough for those.

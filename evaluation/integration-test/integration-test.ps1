# end-to-end test. runs the whole user journey against one cloud
# (register -> login -> create event -> book -> pay -> cancel) and checks
# the business rules reject what they should. also checks the records
# turn up on the other cloud, which is the cross-cloud replication bit.
# usage: .\integration-test.ps1            (runs aws then azure)
#        .\integration-test.ps1 -Target aws
param(
    [ValidateSet('aws','azure','both')] [string]$Target = 'both'
)

# default: run both clouds back to back by calling this same script twice
if ($Target -eq 'both') {
    & $PSCommandPath -Target aws
    Write-Host ""
    & $PSCommandPath -Target azure
    return
}

$awsBase   = "https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com"
$azureBase = "https://eventapp-func-zhw36q.azurewebsites.net"

if ($Target -eq 'aws') { $api = $awsBase; $peer = $azureBase; $peerName = 'azure' }
else                   { $api = $azureBase; $peer = $awsBase;  $peerName = 'aws' }

$tag  = "e2e-" + (Get-Date -Format "MMddHHmmss")
$pass = 0
$fail = 0

function Call($method, $url, $body, $token) {
    $headers = @{}
    if ($token) { $headers["Authorization"] = "Bearer $token" }
    $args = @{ Uri = $url; Method = $method; UseBasicParsing = $true; TimeoutSec = 20 }
    if ($headers.Count -gt 0) { $args.Headers = $headers }
    if ($body) { $args.Body = ($body | ConvertTo-Json); $args.ContentType = "application/json" }
    try {
        $r = Invoke-WebRequest @args
        return @{ status = [int]$r.StatusCode; data = ($r.Content | ConvertFrom-Json) }
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
        return @{ status = $code; data = $null }
    }
}

# every check is recorded as well as printed, so the run leaves a CSV behind
# rather than only console output that scrolls away
$script:results = @()

function Check($name, $condition, $detail) {
    if ($condition) {
        $script:pass++
        Write-Host "  PASS  $name"
        $script:results += [pscustomobject]@{
            timestamp = (Get-Date -Format "HH:mm:ss.fff")
            check     = $name
            result    = "PASS"
            detail    = ""
        }
    } else {
        $script:fail++
        Write-Host "  FAIL  $name   ($detail)" -ForegroundColor Red
        $script:results += [pscustomobject]@{
            timestamp = (Get-Date -Format "HH:mm:ss.fff")
            check     = $name
            result    = "FAIL"
            detail    = $detail
        }
    }
}

Write-Host "`nRunning journey against $Target, checking replication to $peerName`n"

# --- accounts ---
Write-Host "accounts"
$hostEmail = "$tag-host@test.local"
$attEmail  = "$tag-attendee@test.local"
$pw = "TestPass123!"

$r = Call POST "$api/users/register" @{ name="Host $tag"; email=$hostEmail; password=$pw; securityQuestion="q"; securityAnswer="test answer" } $null
Check "register host" ($r.status -eq 201) "got $($r.status)"

$r = Call POST "$api/users/register" @{ name="Attendee $tag"; email=$attEmail; password=$pw; securityQuestion="q"; securityAnswer="test answer" } $null
Check "register attendee" ($r.status -eq 201) "got $($r.status)"

$r = Call POST "$api/users/login" @{ email=$hostEmail; password=$pw } $null
Check "login host" ($r.status -eq 200) "got $($r.status)"
$hostToken = $r.data.token

$r = Call POST "$api/users/login" @{ email=$attEmail; password=$pw } $null
$attToken = $r.data.token
Check "login attendee" ($r.status -eq 200) "got $($r.status)"

$r = Call POST "$api/users/login" @{ email=$hostEmail; password="WrongPass123!" } $null
Check "wrong password rejected" ($r.status -eq 401) "got $($r.status)"

# --- account (profile, password) ---
Write-Host "`naccount"
$r = Call GET "$api/users/me" $null $hostToken
Check "get own profile" ($r.status -eq 200 -and $r.data.email -eq $hostEmail) "got $($r.status)"

$r = Call GET "$api/users/me" $null $null
Check "profile needs auth" ($r.status -eq 401) "got $($r.status)"

$r = Call PATCH "$api/users/me" @{ name="Host Renamed" } $hostToken
Check "update profile name" ($r.status -eq 200) "got $($r.status)"

$r = Call PATCH "$api/users/me" @{ name="" } $hostToken
Check "empty name rejected" ($r.status -eq 400) "got $($r.status)"

# change password (current -> new), then confirm the new one logs in
$newPw = "TestPass456!"
$r = Call POST "$api/users/change-password" @{ currentPassword=$pw; newPassword=$newPw } $hostToken
Check "change password" ($r.status -eq 200) "got $($r.status)"

$r = Call POST "$api/users/change-password" @{ currentPassword="WrongPass123!"; newPassword=$newPw } $hostToken
Check "wrong current password rejected" ($r.status -eq 401) "got $($r.status)"

$r = Call POST "$api/users/login" @{ email=$hostEmail; password=$newPw } $null
Check "login with new password" ($r.status -eq 200) "got $($r.status)"
if ($r.data.token) { $hostToken = $r.data.token }

# forgot -> reset via security answer, then confirm reset password logs in
$r = Call POST "$api/users/forgot-password" @{ email=$hostEmail } $null
Check "forgot returns question" ($r.status -eq 200 -and $r.data.question) "got $($r.status)"

$r = Call POST "$api/users/forgot-password" @{ email="nobody-$tag@test.local" } $null
Check "forgot unknown email 404" ($r.status -eq 404) "got $($r.status)"

$r = Call POST "$api/users/reset-password" @{ email=$hostEmail; answer="wrong answer"; newPassword="TestPass789!" } $null
Check "reset wrong answer rejected" ($r.status -eq 400) "got $($r.status)"

$resetPw = "TestPass789!"
$r = Call POST "$api/users/reset-password" @{ email=$hostEmail; answer="test answer"; newPassword=$resetPw } $null
Check "reset with correct answer" ($r.status -eq 200) "got $($r.status)"

$r = Call POST "$api/users/login" @{ email=$hostEmail; password=$resetPw } $null
Check "login after reset" ($r.status -eq 200) "got $($r.status)"
if ($r.data.token) { $hostToken = $r.data.token }

# --- events ---
Write-Host "`nevents"
$future = (Get-Date).AddDays(30).ToString("yyyy-MM-ddTHH:mm:ss")
$past   = (Get-Date).AddDays(-5).ToString("yyyy-MM-ddTHH:mm:ss")

$r = Call POST "$api/events" @{ title="$tag Main"; date=$future; location="Singapore"; capacity=10; price=25 } $hostToken
Check "create event" ($r.status -eq 201) "got $($r.status)"
$eventId = $r.data.event.id
if (-not $eventId) { $eventId = $r.data.id }

$r = Call POST "$api/events" @{ title="$tag Past"; date=$past; location="Singapore"; capacity=5; price=10 } $hostToken
Check "past date rejected" ($r.status -eq 400) "got $($r.status)"

$r = Call POST "$api/events" @{ title="$tag Negative"; date=$future; location="Singapore"; capacity=5; price=-5 } $hostToken
Check "negative price rejected" ($r.status -eq 400) "got $($r.status)"

$r = Call POST "$api/events" @{ title="$tag NoAuth"; date=$future; location="Singapore"; capacity=5; price=10 } $null
Check "create without token rejected" ($r.status -eq 401) "got $($r.status)"

$r = Call GET "$api/events" $null $null
$found = $r.data | Where-Object { $_.id -eq $eventId }
Check "event appears in list" ($null -ne $found) "not in list"

$r = Call GET "$api/users/me/events" $null $hostToken
$mine = $r.data | Where-Object { $_.id -eq $eventId }
Check "event appears in my events" ($r.status -eq 200 -and $null -ne $mine) "got $($r.status)"

# --- bookings ---
Write-Host "`nbookings"
$r = Call POST "$api/bookings" @{ eventId=$eventId; attendeeName="Host $tag"; attendeeEmail=$hostEmail } $hostToken
Check "cannot book own event" ($r.status -eq 409) "got $($r.status)"

$r = Call POST "$api/bookings" @{ eventId=$eventId; attendeeName="Attendee $tag"; attendeeEmail=$attEmail } $attToken
Check "book event" ($r.status -eq 201) "got $($r.status)"
$bookingId = $r.data.booking.id
if (-not $bookingId) { $bookingId = $r.data.id }

$r = Call POST "$api/bookings" @{ eventId=$eventId; attendeeName="Attendee $tag"; attendeeEmail=$attEmail } $attToken
Check "cannot double book" ($r.status -eq 409) "got $($r.status)"

# capacity: 1-seat event, book it, then a third user should be refused
$r = Call POST "$api/events" @{ title="$tag Tiny"; date=$future; location="Singapore"; capacity=1; price=0 } $hostToken
$tinyId = $r.data.event.id
if (-not $tinyId) { $tinyId = $r.data.id }
$r = Call POST "$api/bookings" @{ eventId=$tinyId; attendeeName="Attendee $tag"; attendeeEmail=$attEmail } $attToken
Check "book last seat" ($r.status -eq 201) "got $($r.status)"

$r = Call POST "$api/users/register" @{ name="Third $tag"; email="$tag-third@test.local"; password=$pw; securityQuestion="q"; securityAnswer="test answer" } $null
$r = Call POST "$api/users/login" @{ email="$tag-third@test.local"; password=$pw } $null
$thirdToken = $r.data.token
$r = Call POST "$api/bookings" @{ eventId=$tinyId; attendeeName="Third $tag"; attendeeEmail="$tag-third@test.local" } $thirdToken
Check "full event rejected" ($r.status -eq 409) "got $($r.status)"

# --- payment ---
Write-Host "`npayment"
$r = Call POST "$api/payments" @{ bookingId=$bookingId; amount=25; currency="USD"; cardNumber="4111111111111111" } $attToken
Check "payment accepted" ($r.status -eq 201) "got $($r.status)"

$r = Call POST "$api/bookings" @{ eventId=$eventId; attendeeName="Third $tag"; attendeeEmail="$tag-third@test.local" } $thirdToken
$declineBooking = $r.data.booking.id
if (-not $declineBooking) { $declineBooking = $r.data.id }
$r = Call POST "$api/payments" @{ bookingId=$declineBooking; amount=25; currency="USD"; cardNumber="4111111111110000" } $thirdToken
Check "card ending 0000 declined" ($r.status -eq 402) "got $($r.status)"

# --- cross-cloud replication ---
Write-Host "`nreplication to $peerName"
Start-Sleep -Seconds 3
$r = Call GET "$peer/events" $null $null
$replicated = $r.data | Where-Object { $_.id -eq $eventId }
Check "event replicated" ($null -ne $replicated) "not found on $peerName"

$r = Call POST "$peer/users/login" @{ email=$attEmail; password=$pw } $null
Check "user replicated (can log in on peer)" ($r.status -eq 200) "got $($r.status)"
$peerToken = $r.data.token

$r = Call GET "$peer/users/me/bookings" $null $peerToken
$b = $r.data | Where-Object { $_.id -eq $bookingId }
Check "booking replicated" ($null -ne $b) "not found on $peerName"

# --- cancel + notification ---
Write-Host "`ncancel"
# attendee cancels their own booking (soft delete)
$r = Call POST "$api/bookings/$bookingId/cancel" $null $attToken
Check "attendee cancels booking" ($r.status -eq 200) "got $($r.status)"

$r = Call POST "$api/bookings/$bookingId/cancel" $null $null
Check "booking cancel needs auth" ($r.status -eq 401) "got $($r.status)"

$r = Call POST "$api/events/$eventId/cancel" $null $hostToken
Check "host cancels event" ($r.status -eq 200) "got $($r.status)"

$r = Call GET "$api/events" $null $null
$stillThere = $r.data | Where-Object { $_.id -eq $eventId }
Check "cancelled event hidden from list" ($null -eq $stillThere) "still listed"

Start-Sleep -Seconds 2
$r = Call GET "$api/notifications" $null $attToken
Check "attendee got refund notification" ($r.data.Count -gt 0) "no notifications"

# --- delete account ---
# uses a throwaway user so it doesn't disturb the accounts above
Write-Host "`ndelete account"
$delEmail = "$tag-delete@test.local"
$r = Call POST "$api/users/register" @{ name="Delete $tag"; email=$delEmail; password=$pw; securityQuestion="q"; securityAnswer="test answer" } $null
$r = Call POST "$api/users/login" @{ email=$delEmail; password=$pw } $null
$delToken = $r.data.token

$r = Call DELETE "$api/users/me" $null $delToken
Check "delete own account" ($r.status -eq 200) "got $($r.status)"

$r = Call POST "$api/users/login" @{ email=$delEmail; password=$pw } $null
Check "deleted account cannot log in" ($r.status -eq 401) "got $($r.status)"

# --- cleanup ---
# The "Tiny" event is deliberately left full by the capacity checks above, so
# without this it stays visible on the events page after the run. Cancelling
# it here is a housekeeping step, not a scored check, so the pass count stays
# comparable between runs. The cancellation replicates to the peer cloud on
# its own, so one call clears it from both.
if ($tinyId) {
    $c = Call POST "$api/events/$tinyId/cancel" $null $hostToken
    if ($c.status -eq 200) {
        Write-Host "`ncleanup: cancelled leftover '$tag Tiny' event"
    } else {
        Write-Host "`ncleanup: could not cancel '$tag Tiny' (status $($c.status)) - cancel it manually" -ForegroundColor Yellow
    }
}

$runId   = Get-Date -Format "MMddHHmmss"
$outFile = "integration-test-$Target-$runId.csv"
$script:results | Export-Csv -Path $outFile -NoTypeInformation -Encoding UTF8

Write-Host "`n===== $Target : $pass passed, $fail failed ====="
Write-Host "results saved to $outFile"
Write-Host "test data tagged '$tag'. it makes events/bookings/payments too,"
Write-Host "so delete child rows first or the FKs block it. run on BOTH clouds:"
Write-Host "  DELETE FROM notifications WHERE recipient_email LIKE '$tag%';"
Write-Host "  DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE attendee_email LIKE '$tag%');"
Write-Host "  DELETE FROM bookings WHERE attendee_email LIKE '$tag%';"
Write-Host "  DELETE FROM events WHERE title LIKE '$tag%';"
Write-Host "  DELETE FROM users WHERE email LIKE '$tag%';"

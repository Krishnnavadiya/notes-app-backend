$ErrorActionPreference = "Stop"
$base = "http://localhost:3001"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Pass($msg) { Write-Host "    OK  $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "    FAIL $msg" -ForegroundColor Red; exit 1 }

function Req($method, $path, $body=$null, $token=$null, $expectStatus=200) {
  $headers = @{ "Content-Type" = "application/json" }
  if ($token) { $headers.Authorization = "Bearer $token" }
  $params = @{
    Method = $method
    Uri = "$base$path"
    Headers = $headers
    UseBasicParsing = $true
  }
  if ($body -ne $null) { $params.Body = ($body | ConvertTo-Json -Depth 5 -Compress) }
  $code = 0
  $text = ""
  try {
    $resp = Invoke-WebRequest @params
    $code = [int]$resp.StatusCode
    $text = $resp.Content
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      $code = [int]$_.Exception.Response.StatusCode
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $text = $reader.ReadToEnd()
    } else { Fail "Network error: $_" }
  } catch {
    if ($_.Exception.Response) {
      $code = [int]$_.Exception.Response.StatusCode
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
      } catch { $text = "" }
    } else { Fail "Unexpected error: $_" }
  }
  $obj = $null
  if ($text -and $text.Length -gt 0) {
    try { $obj = $text | ConvertFrom-Json } catch { $obj = $null }
  }
  if ($code -ne $expectStatus) {
    Fail "Expected $expectStatus for $method $path, got $code. Body: $text"
  }
  return $obj
}

Step "1. GET / root"
$r = Req GET "/"
if ($r.name -ne "Notes App API") { Fail "Unexpected root response" }
Pass "root returns API info"

Step "2. GET /healthz"
$r = Req GET "/healthz"
if ($r.status -ne "ok") { Fail "healthz wrong" }
Pass "healthz ok"

Step "3. GET /openapi.json"
$r = Req GET "/openapi.json"
if (-not $r.openapi.StartsWith("3.")) { Fail "openapi version wrong" }
Pass "openapi $($r.openapi) with $(($r.paths | Get-Member -MemberType NoteProperty).Count) paths"

Step "4. GET /about"
$r = Req GET "/about"
if (-not $r.name) { Fail "about missing name" }
Pass "about returned name=$($r.name), $((($r.'my features' | Get-Member -MemberType NoteProperty).Count)) features"

# Use unique emails per test run
$ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$alice = "alice-$ts@example.com"
$bob = "bob-$ts@example.com"
$pw = "StrongP@ssw0rd"

Step "5. POST /register (Alice)"
$r = Req POST "/register" @{ email=$alice; password=$pw } $null 201
if (-not $r.user.id) { Fail "no user id" }
Pass "alice registered: $($r.user.id)"

Step "6. POST /register again (duplicate -> 409)"
$null = Req POST "/register" @{ email=$alice; password=$pw } $null 409
Pass "duplicate rejected"

Step "7. POST /register with bad email -> 400"
$null = Req POST "/register" @{ email="not-an-email"; password=$pw } $null 400
Pass "bad email rejected"

Step "8. POST /register with short password -> 400"
$null = Req POST "/register" @{ email="x-$ts@x.com"; password="short" } $null 400
Pass "short password rejected"

Step "9. POST /register Bob"
$null = Req POST "/register" @{ email=$bob; password=$pw } $null 201
Pass "bob registered"

Step "10. POST /login with wrong password -> 401"
$null = Req POST "/login" @{ email=$alice; password="wrongpassword" } $null 401
Pass "wrong password rejected"

Step "11. POST /login (Alice)"
$r = Req POST "/login" @{ email=$alice; password=$pw }
$aliceToken = $r.access_token
if (-not $aliceToken) { Fail "no token" }
Pass "alice logged in"

Step "12. POST /login (Bob)"
$r = Req POST "/login" @{ email=$bob; password=$pw }
$bobToken = $r.access_token
Pass "bob logged in"

Step "13. GET /notes without token -> 401"
$null = Req GET "/notes" $null $null 401
Pass "unauthenticated rejected"

Step "14. GET /notes (empty)"
$r = Req GET "/notes" $null $aliceToken
if ($r.items.Count -ne 0) { Fail "expected empty" }
Pass "empty list with pagination envelope"

Step "15. POST /notes (Alice)"
$r = Req POST "/notes" @{
  title="Grocery list"; content="milk, eggs"; tags=@("personal","shopping"); pinned=$true
} $aliceToken 201
$note1 = $r.id
if (-not $note1) { Fail "no note id" }
if ($r.tags.Count -ne 2) { Fail "tags missing" }
if (-not $r.pinned) { Fail "pinned not set" }
Pass "note created: $note1"

Step "16. POST /notes (second)"
$r = Req POST "/notes" @{ title="Ideas"; content="build a notes app"; tags=@("work") } $aliceToken 201
$note2 = $r.id
Pass "second note: $note2"

Step "17. POST /notes invalid (empty title) -> 400"
$null = Req POST "/notes" @{ title=""; content="x" } $aliceToken 400
Pass "empty title rejected"

Step "18. POST /notes unknown field -> 400"
$null = Req POST "/notes" @{ title="x"; foo="bar" } $aliceToken 400
Pass "unknown field rejected"

Step "19. GET /notes/{id}"
$r = Req GET "/notes/$note1" $null $aliceToken
if ($r.title -ne "Grocery list") { Fail "wrong title" }
Pass "got note by id"

Step "20. GET /notes/{id} with invalid uuid -> 400"
$null = Req GET "/notes/not-a-uuid" $null $aliceToken 400
Pass "bad uuid rejected"

Step "21. GET /notes/{id} non-existent -> 404"
$null = Req GET "/notes/00000000-0000-0000-0000-000000000000" $null $aliceToken 404
Pass "non-existent 404"

Step "22. Bob can't see Alice's note -> 403"
$null = Req GET "/notes/$note1" $null $bobToken 403
Pass "ownership enforced"

Step "23. PUT /notes/{id} (update content)"
$r = Req PUT "/notes/$note1" @{ content="milk, eggs, bread" } $aliceToken
if ($r.content -notmatch "bread") { Fail "update failed" }
Pass "note updated"

Step "24. PUT /notes/{id} with no fields -> 400"
$null = Req PUT "/notes/$note1" @{} $aliceToken 400
Pass "empty PUT rejected"

Step "25. POST /notes/{id}/share with Bob"
$r = Req POST "/notes/$note1/share" @{ share_with_email=$bob; permission="write" } $aliceToken
Pass "shared: $($r.message)"

Step "26. POST /notes/{id}/share to self -> 400"
$null = Req POST "/notes/$note1/share" @{ share_with_email=$alice } $aliceToken 400
Pass "self-share rejected"

Step "27. POST /notes/{id}/share to non-existent user -> 404"
$null = Req POST "/notes/$note1/share" @{ share_with_email="nobody-$ts@example.com" } $aliceToken 404
Pass "share to unknown user 404"

Step "28. Bob can now GET the shared note"
$r = Req GET "/notes/$note1" $null $bobToken
if ($r.title -ne "Grocery list") { Fail "Bob can't read" }
Pass "shared read works"

Step "29. Bob can PUT (write permission)"
$r = Req PUT "/notes/$note1" @{ content="milk, eggs, bread, cheese" } $bobToken
Pass "shared write works"

Step "30. Bob CANNOT change tags (owner-only field) -> 403"
$null = Req PUT "/notes/$note1" @{ tags=@("hijacked") } $bobToken 403
Pass "tag change blocked for collaborator"

Step "31. Bob CANNOT delete -> 403"
$null = Req DELETE "/notes/$note1" $null $bobToken 403
Pass "delete blocked for collaborator"

Step "32. GET /notes/{id}/versions"
$r = Req GET "/notes/$note1/versions" $null $aliceToken
if ($r.versions.Count -lt 2) { Fail "expected at least 2 versions" }
Pass "versions tracked: $($r.versions.Count) snapshots"

Step "33. GET /notes/{id}/shares"
$r = Req GET "/notes/$note1/shares" $null $aliceToken
if ($r.shares.Count -ne 1) { Fail "share missing" }
Pass "shares listed"

Step "34. GET /notes (Alice sees both)"
$r = Req GET "/notes" $null $aliceToken
if ($r.items.Count -ne 2) { Fail "expected 2 notes" }
Pass "alice has 2 notes"

Step "35. GET /notes?tag=work"
$r = Req GET "/notes?tag=work" $null $aliceToken
if ($r.items.Count -ne 1) { Fail "tag filter wrong" }
Pass "tag filter works"

Step "36. GET /notes?page=1&limit=1 (pagination)"
$r = Req GET "/notes?page=1&limit=1" $null $aliceToken
if ($r.items.Count -ne 1) { Fail "limit wrong" }
if ($r.pagination.total_pages -ne 2) { Fail "pages wrong" }
Pass "pagination works"

Step "37. GET /notes?shared=shared (Bob sees Alice's note)"
$r = Req GET "/notes?shared=shared" $null $bobToken
if ($r.items.Count -ne 1) { Fail "shared filter wrong" }
Pass "shared filter works"

Step "38. GET /search?q=bread"
$r = Req GET "/search?q=bread" $null $aliceToken
if ($r.items.Count -ne 1) { Fail "search missed" }
Pass "search works"

Step "39. GET /search without q -> 400"
$null = Req GET "/search" $null $aliceToken 400
Pass "missing q rejected"

Step "40. PUT to archive note"
$r = Req PUT "/notes/$note2" @{ archived=$true } $aliceToken
if (-not $r.archived) { Fail "archive failed" }
Pass "archived"

Step "41. GET /notes default hides archived"
$r = Req GET "/notes" $null $aliceToken
if ($r.items.Count -ne 1) { Fail "archived note still shown" }
Pass "archive default-hidden"

Step "42. GET /notes?archived=true"
$r = Req GET "/notes?archived=true" $null $aliceToken
if ($r.items.Count -ne 1) { Fail "archived filter wrong" }
Pass "archived filter works"

Step "43. DELETE /notes/{id}/share (revoke Bob)"
$r = Req DELETE "/notes/$note1/share" @{ revoke_email=$bob } $aliceToken
Pass "revoked: $($r.message)"

Step "44. Bob can no longer read -> 403"
$null = Req GET "/notes/$note1" $null $bobToken 403
Pass "revoke enforced"

Step "45. DELETE /notes/{id}"
$null = Req DELETE "/notes/$note1" $null $aliceToken 204
Pass "deleted"

Step "46. GET deleted note -> 404"
$null = Req GET "/notes/$note1" $null $aliceToken 404
Pass "deleted is gone"

Step "47. POST /register with extra unknown key -> 400 (strict)"
$null = Req POST "/register" @{ email="z-$ts@x.com"; password=$pw; foo="bar" } $null 400
Pass "strict body validation"

Step "48. Malformed JSON -> 400"
$code48 = 0
try {
  $resp = Invoke-WebRequest -Method POST -Uri "$base/login" -Headers @{ "Content-Type"="application/json" } -Body "{not json" -UseBasicParsing
  $code48 = [int]$resp.StatusCode
} catch {
  if ($_.Exception.Response) { $code48 = [int]$_.Exception.Response.StatusCode }
}
if ($code48 -ne 400) { Fail "expected 400 for malformed JSON, got $code48" }
Pass "malformed JSON rejected"

Step "49. Unknown route -> 404"
$null = Req GET "/nope" $null $null 404
Pass "unknown route 404"

Write-Host "`n==================================="  -ForegroundColor Green
Write-Host "ALL 49 SMOKE TESTS PASSED" -ForegroundColor Green
Write-Host "==================================="  -ForegroundColor Green

param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$Output = "novacart-backup-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
)
if (-not $DatabaseUrl) { throw "Set DATABASE_URL or pass -DatabaseUrl." }
pg_dump --format=custom --no-owner --file $Output $DatabaseUrl
Write-Host "Backup created: $Output"

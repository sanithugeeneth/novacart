#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?Set DATABASE_URL first}"
out="novacart-backup-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --file "$out" "$DATABASE_URL"
echo "Backup created: $out"

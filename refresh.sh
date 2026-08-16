#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "== WatchRecon =="
node scrapers/watchrecon-scraper.js --brand=rolex --days=7

echo ""
echo "== WatchPatrol =="
node scrapers/watchpatrol-scraper.js --query="rolex submariner"

echo ""
echo "== Merging sources =="
node scrapers/merge.js

echo ""
echo "== Building dashboard =="
node scrapers/build-dashboard.js

echo ""
echo "== Opening dashboard =="
open watch-scout-dashboard.html

echo ""
echo "Done — dashboard refreshed and opened."

#!/usr/bin/env bash
# Fork this repo, enable GitHub Pages, print the values you need for the Spotify dashboard.
set -euo pipefail

command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login"; exit 1; }

ME=$(gh api user --jq .login)
gh repo fork HaidarESBER/nowplaying --clone=false >/dev/null 2>&1 || true

# a fresh fork can take a moment to appear
for _ in 1 2 3 4 5; do
  gh api "repos/$ME/nowplaying" >/dev/null 2>&1 && break
  sleep 2
done

gh api -X POST "repos/$ME/nowplaying/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true

LOWER=$(echo "$ME" | tr '[:upper:]' '[:lower:]')
URL="https://${LOWER}.github.io/nowplaying/"

echo
echo "Your site (live in about a minute): $URL"
echo
echo "Next: https://developer.spotify.com/dashboard -> Create app -> tick Web API"
echo "  Redirect URI to add:  $URL"
echo "Then open the site, paste the Client ID and press Connect."

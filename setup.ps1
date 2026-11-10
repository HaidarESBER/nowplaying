# Fork this repo, enable GitHub Pages, print the values you need for the Spotify dashboard.
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'Install the GitHub CLI first: https://cli.github.com'; exit 1
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Run: gh auth login'; exit 1 }

$me = gh api user --jq .login
gh repo fork HaidarESBER/nowplaying --clone=false *> $null

# a fresh fork can take a moment to appear
for ($i = 0; $i -lt 5; $i++) {
  gh api "repos/$me/nowplaying" *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 2
}

gh api -X POST "repos/$me/nowplaying/pages" -f "source[branch]=main" -f "source[path]=/" *> $null

$url = "https://$($me.ToLower()).github.io/nowplaying/"
Write-Host ''
Write-Host "Your site (live in about a minute): $url"
Write-Host ''
Write-Host 'Next: https://developer.spotify.com/dashboard -> Create app -> tick Web API'
Write-Host "  Redirect URI to add:  $url"
Write-Host 'Then open the site, paste the Client ID and press Connect.'

$ErrorActionPreference = "Stop"
$today = Get-Date
$from = $today.AddYears(-1).ToString("yyyy-MM-dd")
$to = $today.ToString("yyyy-MM-dd")
$uri = "https://github.com/users/zx67834/contributions?from=$from&to=$to"
$html = (Invoke-WebRequest -Uri $uri -UseBasicParsing).Content
$cells = [regex]::Matches($html, '<td[^>]*data-date="([^"]+)"[^>]*data-level="([0-4])"[^>]*>')
$days = foreach ($cell in $cells) {
  [pscustomobject]@{
    date = $cell.Groups[1].Value
    level = [int]$cell.Groups[2].Value
  }
}
if ($days.Count -eq 0) { throw "No contribution cells found" }
$totalMatch = [regex]::Match($html, '([0-9,]+)\s+contributions?', 'IgnoreCase')
$total = if ($totalMatch.Success) { [int]($totalMatch.Groups[1].Value -replace ',', '') } else { $null }
$result = [pscustomobject]@{
  source = "github"
  username = "zx67834"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  total = $total
  days = @($days)
}
$outputDir = Join-Path $PSScriptRoot "..\public\data"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputDir "github-contributions.json") -Encoding utf8
Write-Output "Saved $($days.Count) GitHub contribution cells."

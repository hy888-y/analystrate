# Deploy the code on this laptop (Version A: 5-factor score + model comparison) to the live site.
# Steps: tests -> recompute results -> commit + push to GitHub (Render rebuilds) -> copy data to Neon.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"
function Step($msg) { Write-Host "`n==== $msg ====" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED: $what failed. Nothing after this step was done." -ForegroundColor Red; exit 1 } }

Set-Location (Join-Path $root "backend")

Step "1/4 Running tests"
& $py -m pytest -q
Check "Tests"

Step "2/4 Recomputing scores + evaluation (takes a few minutes)"
& $py -m flask --app wsgi compute
Check "Compute"

Step "3/4 Committing and pushing code to GitHub (Render will rebuild the site)"
Set-Location $root
if (Test-Path ".git\index.lock") { Write-Host "STOPPED: .git\index.lock exists. Close VS Code / other git tools and delete that file, then run again." -ForegroundColor Red; exit 1 }
git add -u
git commit -m "Restore Version A: 5-factor confidence score, full model comparison (LR/RF/GB) and LIME evaluation per IR 2.2.5"
if ($LASTEXITCODE -ne 0) { Write-Host "(nothing new to commit, continuing)" -ForegroundColor Yellow }
git push origin main
Check "git push"

Step "4/4 Copying the fresh results to the live database (Neon)"
$sec = Read-Host "Paste your Neon connection string (postgresql://...) and press Enter" -AsSecureString
$neon = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
Set-Location (Join-Path $root "backend")
& $py -m flask --app wsgi copy-db $neon
Check "copy-db"

Write-Host "`nDONE. Render needs ~5-10 min to rebuild. Then open https://analystrate.onrender.com/method" -ForegroundColor Green

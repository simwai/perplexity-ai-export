Write-Host "🔧 Applying validation fixes..." -ForegroundColor Cyan

# 1. Fix WorkerPool to NOT mark failed extractions as processed
$workerPoolPath = "src/scraper/worker-pool.ts"
$workerPool = Get-Content $workerPoolPath -Raw

# Find the processConversation method and replace it
$workerPool = $workerPool -replace `
  '(const extracted = await worker\.extractor\.extract\(metadata\.url\)\s+if \(extracted\) \{[^}]+\} else \{[^}]+\}\s+)(this\.checkpointManager\.markProcessed\(metadata\.url\))', `
  '$1// Moved markProcessed inside success block'

# Move markProcessed inside the if (extracted) block
$workerPool = $workerPool -replace `
  '(const filepath = this\.fileWriter\.write\(extracted\)\s+logger\.success\(`Worker \$\{worker\.id\} saved: \$\{filepath\}`\))', `
  '$1`n        this.checkpointManager.markProcessed(metadata.url) // ✅ Only mark if successful'

Set-Content $workerPoolPath $workerPool -Encoding UTF8
Write-Host "✓ Fixed WorkerPool to only mark successful extractions" -ForegroundColor Green

Write-Host "`n✨ Fixes applied! Run the scraper to see proper error tracking." -ForegroundColor Cyan

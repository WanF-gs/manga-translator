$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:8080/api/v1"

# ====== STEP 0: Register ======
Write-Host "[0/6] Register"
$regBody = '{"email":"finaltest@manga.com","password":"pass123","nickname":"FinalTest"}'
$reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType "application/json" -Body $regBody
$token = $reg.data.tokens.access_token
$hdrs = @{Authorization="Bearer $token"; "Content-Type"="application/json"}
Write-Host "  OK: token=" $token.Substring(0,20) "..."

# ====== STEP 1: Create project ======
Write-Host "[1/6] Create project"
$proj = Invoke-RestMethod -Uri "$base/projects" -Method Post -Headers $hdrs -Body '{"name":"E2E-Pipeline","source_lang":"ja","target_lang":"zh-CN"}'
$projId = $proj.data.project_id
Write-Host "  OK: $projId"

# ====== STEP 2: Create chapter ======
Write-Host "[2/6] Create chapter"
$ch = Invoke-RestMethod -Uri "$base/projects/$projId/chapters" -Method Post -Headers $hdrs -Body '{"name":"ch1","sort_order":1}'
$chId = $ch.data.chapter_id
Write-Host "  OK: $chId"

# ====== STEP 3: Upload image ======
Write-Host "[3/6] Upload image"
$img = "c:\Users\WanFi\Desktop\大三实训\demo_04\测试项目\Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_005_图像_0001.jpg"
$upRaw = curl.exe -s -X POST "$base/projects/$projId/chapters/$chId/pages/upload" -H "Authorization: Bearer $token" -F "file=@$img" -F "sort_order=1"
if ($upRaw -match '"page_id"\s*:\s*"([a-f0-9-]+)"') { $pageId = $matches[1] } else { throw "Upload failed: $upRaw" }
Write-Host "  OK: $pageId"

# ====== STEP 4: Detect ======
Write-Host "[4/6] Text detection"
$sw = [Diagnostics.Stopwatch]::StartNew()
$det = Invoke-RestMethod -Uri "$base/pages/$pageId/detect" -Method Post -Headers $hdrs -Body "{}" -TimeoutSec 120
$sw.Stop()
Write-Host "  OK: $($det.message) | regions=$($det.data.count) | ${0:f2}s" -f $sw.Elapsed.TotalSeconds

# ====== STEP 5: OCR ======
Write-Host "[5/6] OCR"
$sw.Restart()
$ocr = Invoke-RestMethod -Uri "$base/pages/$pageId/ocr" -Method Post -Headers $hdrs -Body "{}" -TimeoutSec 180
$sw.Stop()
$textCount = 0; $regions = @($ocr.data.results)
foreach ($r in $regions) { if ($r.text -and $r.text.Trim()) { $textCount++ } }
Write-Host "  OK: $($ocr.message) | textRegions=$textCount/$($regions.Count) | ${0:f2}s" -f $sw.Elapsed.TotalSeconds
if ($textCount -gt 0) {
    foreach ($r in $regions) {
        $t = $r.text.Trim()
        if ($t) { Write-Host "    [$($r.confidence)] $t" }
    }
}

# ====== STEP 6: Translate ======
if ($textCount -gt 0) {
    Write-Host "[6/6] Translation"
    $sw.Restart()
    $trans = Invoke-RestMethod -Uri "$base/pages/$pageId/translate" -Method Post -Headers $hdrs -Body "{}" -TimeoutSec 180
    $sw.Stop()
    Write-Host "  OK: $($trans.message) | ${0:f2}s" -f $sw.Elapsed.TotalSeconds
    if ($trans.data.results) {
        foreach ($r in $trans.data.results) {
            $orig = ($r.original_text -replace '\s+',' ').Trim()
            $tran = ($r.translated_text -replace '\s+',' ').Trim()
            if ($tran) { Write-Host "    $orig -> $tran" }
        }
    }
} else {
    Write-Host "[6/6] Translation SKIPPED (no OCR text)"
}

Write-Host "========== ALL DONE =========="
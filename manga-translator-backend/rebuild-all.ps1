# ============================================
# 漫画翻译系统 - 全量镜像重建脚本
# 永久修复 Python 依赖缺失问题
# ============================================

Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  开始重建所有 Docker 镜像 (--no-cache)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 确保 GOPROXY 已设置（gateway 用）
$env:GOPROXY = "https://goproxy.cn,direct"

# 停止现有容器
Write-Host "`n[1/3] 停止现有容器..." -ForegroundColor Yellow
docker compose down

# 全量重建（无缓存）
Write-Host "`n[2/3] 重建所有镜像（可能需要5-15分钟）..." -ForegroundColor Yellow
docker compose build --no-cache

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n构建失败！请检查上方错误信息。" -ForegroundColor Red
    exit 1
}

# 启动所有服务
Write-Host "`n[3/3] 启动所有服务..." -ForegroundColor Yellow
docker compose up -d

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  重建完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Gateway:  http://localhost:8080" -ForegroundColor White
Write-Host "MinIO:    http://localhost:9001" -ForegroundColor White
Write-Host "Grafana:  http://localhost:3001" -ForegroundColor White

# 等待服务启动完成后验证
Write-Host "`n等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

# 验证 prometheus 依赖
Write-Host "`n验证依赖安装..." -ForegroundColor Yellow
docker exec manga-user-service python -c "import prometheus_client, prometheus_fastapi_instrumentator, pythonjsonlogger; print('所有监控依赖已正确安装!')"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ prometheus 依赖验证通过" -ForegroundColor Green
} else {
    Write-Host "✗ 依赖验证失败" -ForegroundColor Red
}

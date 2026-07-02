# AI 助手上下文

> 任何 AI 助理解析本项目时的快速参考。请先阅读本文件和 README.md。

## 运行环境

- **后端所有微服务**：在 **WSL2** 中原生运行（非 Docker）
- **PostgreSQL**：WSL2 端口 **5433**（不是 Docker 的 5432）
- **前端**：Windows/WSL2 均可，端口 3000
- **Python**：WSL2 中为 3.8（代码需兼容 `from __future__ import annotations`）

## 一键启动后端

```bash
# 在 WSL2 终端中执行
bash /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/start_wsl2_all.sh
```

## 服务端口一览

| 服务 | 端口 |
|------|------|
| PostgreSQL | 5433 |
| Redis | 6379 |
| MinIO | 9000 |
| user-service | 8001 |
| project-service | 8002 |
| translation-service | 8003 |
| image-service | 8004 |
| export-service | 8005 |
| reader-service | 8006 |
| notification-service | 8007 |
| ai-gateway | 8100 |

## 关键注意事项

1. **环境变量**中所有服务地址用 `localhost`，不用 Docker 服务名（如 `postgres`、`user-service`）
2. **DATABASE_URL** 端口是 5433
3. **FONT_DIR** 用 WSL2 路径 `/mnt/c/Users/WanFi/Desktop/...`，不是 Windows 路径
4. **UPLOAD_DIR** 设为 `/tmp/manga-uploads`（避免权限问题）
5. 服务进程使用 `nohup` + `disown` 后台运行，日志在 `/tmp/mt-svc-*.log`
6. Go 网关 (8080) 不在一键启动脚本中，需要单独编译
7. 前端代码在 `manga-translator-web/`，后端代码在 `manga-translator-backend/services/`

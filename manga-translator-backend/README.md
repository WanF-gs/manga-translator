# 漫画多语言智能翻译系统 - 后端

## 项目结构

```
manga-translator-backend/
├── gateway/                          # Go API 网关 (Gin)
│   ├── cmd/main.go                   # 入口
│   ├── internal/
│   │   ├── config/                   # 配置
│   │   ├── handler/                  # 处理器 (代理、上传、健康检查)
│   │   ├── middleware/               # 中间件 (CORS、JWT、限流、日志、恢复)
│   │   ├── router/                   # 路由
│   │   └── service/                  # 服务 (服务发现、JWT验证)
│   ├── Dockerfile
│   └── Makefile
├── services/                         # Python 微服务
│   ├── common/                       # 共享库
│   │   ├── core/                     # 核心 (配置、数据库、异常、响应、安全)
│   │   ├── models/                   # SQLAlchemy ORM 模型 (13张表)
│   │   └── middleware/               # 中间件 (请求ID、认证、套餐检查)
│   ├── user_service/                 # 用户服务 :8001
│   ├── project_service/              # 项目服务 :8002
│   ├── translation_service/          # 翻译服务 :8003
│   ├── image_service/                # 图像处理服务 :8004
│   ├── export_service/               # 导出服务 :8005
│   └── reader_service/               # 阅读服务 :8006
├── docker-compose.yml                # 容器编排
├── .env.example                      # 环境变量模板
└── Makefile                          # 项目命令
```

## 快速开始

### 前置条件

- Docker & Docker Compose
- Go 1.21+ (本地开发)
- Python 3.11+ (本地开发)

### 使用 Docker Compose 启动

```bash
# 1. 复制环境变量
cp .env.example .env

# 2. 启动所有服务
docker-compose up -d

# 3. 初始化数据库
make init-db

# 4. 查看服务状态
make ps
```

### 本地开发

```bash
# 1. 安装 Python 依赖
pip install -r services/requirements.txt

# 2. 启动基础设施
docker-compose up -d postgres redis minio

# 3. 分别启动各微服务
cd services/user_service && uvicorn main:app --port 8001 --reload
cd services/project_service && uvicorn main:app --port 8002 --reload
# ...

# 4. 启动网关
cd gateway && go run cmd/main.go
```

## API 概览

所有 API 通过网关统一访问: `http://localhost:8080/api/v1/`

| 模块 | 路径前缀 | 服务 | 端口 |
|------|----------|------|------|
| 用户认证 | `/api/v1/auth/*` | user-service | 8001 |
| 用户资料 | `/api/v1/profile/*` | user-service | 8001 |
| 项目管理 | `/api/v1/projects/*` | project-service | 8002 |
| 章节管理 | `/api/v1/chapters/*` | project-service | 8002 |
| 页面管理 | `/api/v1/pages/*` | project-service / image-service | 8002/8004 |
| 文字检测 | `/api/v1/pages/{id}/detect` | image-service | 8004 |
| OCR识别 | `/api/v1/pages/{id}/ocr` | image-service | 8004 |
| 图像修复 | `/api/v1/pages/{id}/inpaint` | image-service | 8004 |
| 文字渲染 | `/api/v1/pages/{id}/render` | image-service | 8004 |
| 图像增强 | `/api/v1/pages/{id}/enhance` | image-service | 8004 |
| 翻译 | `/api/v1/pages/{id}/translate` | translation-service | 8003 |
| 术语管理 | `/api/v1/terms/*` | translation-service | 8003 |
| 翻译记忆 | `/api/v1/memory/*` | translation-service | 8003 |
| 样式预设 | `/api/v1/presets/*` | project-service | 8002 |
| 导出 | `/api/v1/exports/*` | export-service | 8005 |
| 阅读会话 | `/api/v1/reader/*` | reader-service | 8006 |
| 生词本 | `/api/v1/vocab/*` | reader-service | 8006 |

## 技术栈

- **网关**: Go 1.21 + Gin + golang-jwt
- **微服务**: Python 3.11 + FastAPI + SQLAlchemy (async)
- **数据库**: PostgreSQL 16
- **缓存**: Redis 7
- **存储**: MinIO (S3 兼容)
- **容器**: Docker + Docker Compose
- **任务队列**: Celery (Redis broker)

## 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "request_id": "uuid",
  "timestamp": "2025-06-22T17:00:00Z"
}
```

## 错误码

| 范围 | 说明 |
|------|------|
| 0 | 成功 |
| 1000-1999 | 通用错误 |
| 2000-2999 | 认证/授权 |
| 3000-3999 | 业务逻辑 |
| 4000-4999 | 文件相关 |
| 5000-5999 | 系统错误 |

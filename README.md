# 漫画多语言智能翻译与图像合成系统

> Manga Multi-language Intelligent Translation & Image Composition System

## 项目简介

基于AI的漫画多语言智能翻译系统，支持日/中/英/韩多语言漫画的文字检测、OCR识别、智能翻译、背景修复与图像合成。提供PC端专业编辑工作台和移动端双语阅读器。

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18 + Next.js 14 (App Router)、Ant Design 5 + antd-mobile 5、Zustand、react-konva + fabric.js |
| **API网关** | Go (Gin) |
| **后端微服务** | Python FastAPI (7个业务服务) |
| **异步任务** | Celery + Redis (MVP) |
| **数据库** | PostgreSQL 16 (主库) + Redis 7 (缓存/会话) |
| **对象存储** | MinIO (S3兼容) |
| **运行环境** | WSL2 原生运行（PostgreSQL/Redis/MinIO/Python微服务均在WSL2中） |

## 项目结构

```
demo_04/
├── manga-translator-backend/     # 后端服务（Go网关 + Python微服务）
│   ├── gateway/                  # Go API Gateway (Gin)
│   ├── services/                 # 微服务 (FastAPI)
│   │   ├── user_service/         # 用户服务 (8001)
│   │   ├── project_service/      # 项目/页面管理 (8002)
│   │   ├── translation_service/  # 翻译引擎 (8003)
│   │   ├── image_service/        # 图像处理 (8004)
│   │   ├── export_service/       # 导出服务 (8005)
│   │   ├── reader_service/       # 阅读器服务 (8006)
│   │   ├── notification_service/ # 通知服务 (8007)
│   │   ├── ai_gateway/           # AI模型网关 (8100)
│   │   └── common/               # 共享模块 (models, tasks)
│   └── docker-compose.yml        # Docker编排
├── manga-translator-web/         # 前端 (Next.js 14)
│   └── src/
│       ├── app/                  # App Router (PC端 + 移动端)
│       ├── components/           # UI组件
│       ├── stores/               # Zustand状态管理
│       └── lib/                  # 工具库/API客户端
├── database/                     # 数据库脚本
│   ├── ddl/                      # DDL建表脚本
│   ├── dml/                      # DML种子/测试数据
│   └── functions/                # 数据库函数/触发器
├── architecture/                 # 架构设计文档
├── prd/                          # 产品需求文档
└── docs/                         # 开发文档
```

## 快速启动

### 运行环境

当前项目在 **WSL2** 中原生运行，不再依赖 Docker Desktop：

- **WSL2 (Ubuntu)** — 运行 PostgreSQL、Redis、MinIO 及所有 Python 微服务
- **Node.js 18+** — 前端开发（Windows/WSL2 均可）
- **Python 3.8+** — 后端微服务（WSL2 中）

### 启动后端服务（WSL2 一键启动）

在 WSL2 终端中执行：

```bash
bash /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/start_wsl2_all.sh
```

该脚本会自动检测并启动 PostgreSQL(5433)/Redis(6379)/MinIO(9000)，随后以 nohup 后台方式启动全部 8 个 Python 微服务。

服务端口映射：
| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | **5433** | WSL2 原生（非 Docker 的 5432） |
| Redis | 6379 | |
| MinIO API | 9000 | |
| MinIO Console | 9001 | |
| User Service | 8001 | |
| Project Service | 8002 | |
| Translation Service | 8003 | |
| Image Service | 8004 | |
| Export Service | 8005 | |
| Reader Service | 8006 | |
| Notification Service | 8007 | |
| AI Gateway | 8100 | |
| API Gateway (Go) | 8080 | 需单独编译：`cd gateway && go build -o gateway ./cmd/main.go && ./gateway` |

### 启动前端

```bash
cd manga-translator-web
npm install
npm run dev
```

前端访问地址：`http://localhost:3000`

## 核心处理管线

```
[上传图片] → [预处理] → [文字区域检测] → [OCR识别] → [翻译]
                                                         │
                   ┌─────────────────────────────────────┘
                   ▼
             [背景修复/擦除] → [文字回填渲染] → [成品输出]
```

## 开发指南

详见:
- [PRD文档](./prd/manga-translator-v0.1-prd.md)
- [系统架构设计说明书](./architecture/系统架构设计说明书.md)
- [前端开发文档](./docs/前端开发文档.md)
- [数据库设计文档](./database/README.md)

## 当前开发阶段

**Phase 1 MVP** — 已完成约60%

- ✅ 微服务骨架、数据库完整、前端页面路由齐全
- ✅ Go API Gateway (JWT鉴权/限流/路由分发)
- ✅ 用户认证体系 (注册/登录/Token刷新)
- ✅ 项目三级管理 (作品-章节-页面)
- ✅ 翻译记忆缓存 (Redis + PostgreSQL)
- ✅ 撤销/重做机制 (前端20步 + 云端备份)
- ✅ 导出服务 (CBZ/PDF/ZIP)
- ✅ 双端响应式阅读器
- ⚠️ AI处理管线 (检测/OCR/翻译/修复) — 框架已搭建，待集成真实AI模型
- ❌ 超分辨率增强
- ❌ CI/CD + 监控栈
- ❌ BFF代理层

## License

内部项目

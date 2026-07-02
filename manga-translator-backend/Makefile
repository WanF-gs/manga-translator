# ============================================
# 漫画多语言智能翻译系统 - 根 Makefile
# ============================================

.PHONY: help up down restart logs build clean test

# 默认目标
help:
	@echo "漫画多语言智能翻译系统 - 可用命令:"
	@echo ""
	@echo "  make up          启动所有服务"
	@echo "  make down        停止所有服务"
	@echo "  make restart     重启所有服务"
	@echo "  make build       重新构建所有镜像"
	@echo "  make logs        查看所有服务日志"
	@echo "  make logs-gw     查看网关日志"
	@echo "  make logs-svc    查看微服务日志"
	@echo "  make ps          查看服务状态"
	@echo "  make clean       清理容器和卷"
	@echo "  make init-db     初始化数据库"
	@echo "  make test        运行测试"
	@echo ""

# 启动所有服务
up:
	docker-compose up -d

# 停止所有服务
down:
	docker-compose down

# 重启
restart: down up

# 重新构建
build:
	docker-compose build --no-cache

# 查看日志
logs:
	docker-compose logs -f

logs-gw:
	docker-compose logs -f gateway

logs-svc:
	docker-compose logs -f user-service project-service translation-service image-service export-service reader-service

# 查看服务状态
ps:
	docker-compose ps

# 清理
clean:
	docker-compose down -v
	rm -rf uploads/

# 初始化数据库（运行 DDL 脚本）
init-db:
	docker exec -i manga-postgres psql -U manga_user -d manga_translator < database/ddl/01_create_extensions.sql
	docker exec -i manga-postgres psql -U manga_user -d manga_translator < database/ddl/02_create_tables.sql

# 运行测试
test:
	cd gateway && go test ./...

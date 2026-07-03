#!/bin/bash
# ============================================
# WSL2 全栈开发环境 - 一键启动（完整版）
# 启动 PostgreSQL(5433) + Redis + MinIO + 8个Python微服务 + Go API 网关(8080)
# ============================================

PROJECT="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04"
SERVICES="$PROJECT/manga-translator-backend/services"
GATEWAY_DIR="$PROJECT/manga-translator-backend/gateway"
FONT_DIR="$PROJECT/manga-translator-backend/fonts"

echo "==========================================="
echo "  漫画翻译系统 - WSL2 全栈启动"
echo "==========================================="
echo ""

# ---- 1. 启动 PostgreSQL ----
echo "[1/3] 启动基础服务..."
echo -n "  PostgreSQL (5433)... "
if pg_isready -q 2>/dev/null; then
    echo "已运行"
else
    sudo service postgresql start 2>/dev/null || sudo pg_ctlcluster 12 main start 2>/dev/null || sudo pg_ctlcluster 14 main start 2>/dev/null || sudo pg_ctlcluster 16 main start 2>/dev/null
    sleep 1
    pg_isready -q 2>/dev/null && echo "OK" || echo "FAIL"
fi

# ---- 2. 启动 Redis ----
echo -n "  Redis (6379)... "
if redis-cli ping &>/dev/null; then
    echo "已运行"
else
    redis-server --daemonize yes 2>/dev/null
    sleep 1
    redis-cli ping &>/dev/null && echo "OK" || echo "FAIL"
fi

# ---- 3. 启动 MinIO ----
echo -n "  MinIO (9000)... "
if curl -s http://localhost:9000/minio/health/live &>/dev/null; then
    echo "已运行"
else
    mkdir -p "$PROJECT/data/minio-data"
    MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
        setsid minio server "$PROJECT/data/minio-data" --address :9000 --console-address :9001 &>/tmp/minio.log &
        MINIO_PID=$!
    sleep 2
    curl -s http://localhost:9000/minio/health/live &>/dev/null && echo "OK (PID $MINIO_PID)" || echo "FAIL"
fi

echo ""

# ---- 4. 设置共享环境变量 ----
export DATABASE_URL="postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator"
export REDIS_URL="redis://localhost:6379/0"
export JWT_SECRET_KEY="your-super-secret-jwt-key-change-in-production"
export JWT_ACCESS_TOKEN_EXPIRE="86400"   # 24h（默认2h太短，频繁过期导致页面切换卡顿）
export APP_ENV="development"
export LOG_LEVEL="INFO"
export AI_SERVICE_BASE_URL="http://localhost:8100"
export MINIO_ENDPOINT="localhost:9000"
export MINIO_ACCESS_KEY="minioadmin"
export MINIO_SECRET_KEY="minioadmin"
export MINIO_BUCKET="manga-translator"
# 腾讯云密钥 — 请填入真实值
export TENCENT_SECRET_ID="${TENCENT_SECRET_ID:-YOUR_TENCENT_SECRET_ID}"
export TENCENT_SECRET_KEY="${TENCENT_SECRET_KEY:-YOUR_TENCENT_SECRET_KEY}"
export TENCENT_TMT_REGION="ap-guangzhou"
export UPLOAD_DIR="$PROJECT/data/uploads"

# ---- 豆包视觉翻译 (火山方舟 Multimodal Engine) ----
# 模型: doubao-seed-evolving (多模态, 支持图片输入)
# 端点: ep-20260702160219-q87sw (火山方舟→在线推理→接入点)
# 兼容 OpenAI 格式, 原生支持图片输入 (日语漫画→中文翻译)
export OPENAI_API_KEY="ark-3178a889-9195-4d98-bcc0-00cef9fa48d6-e1566"
export OPENAI_API_BASE="https://ark.cn-beijing.volces.com/api/v3"
export OPENAI_MODEL="ep-20260702160219-q87sw"

# P0: OCR 引擎 + HF 离线模式（全局，所有微服务继承）
export PADDLEOCR_ENABLED="true"
export OCR_ENGINE_ORDER="mangaocr,paddleocr"
export OCR_CONFIDENCE_RETRY_THRESHOLD="0.65"
# CTD 文字检测：mask 阈值 0.10 最大化文字召回（代码默认已设为 0.10）
export CTD_MASK_THRESH="0.10"
# 使用国内镜像加速 HuggingFace 模型下载（manga-ocr 等首次加载需要）
export HF_ENDPOINT="https://hf-mirror.com"

# 确保字体目录和上传目录存在（不依赖 Docker 的 /app 路径）
mkdir -p "$PROJECT/data/fonts" "$PROJECT/data/uploads" "$FONT_DIR" 2>/dev/null
export FONT_DIR
# 确保用户 pip 包路径可用
export PATH="$HOME/.local/bin:$PATH"
export PYTHONPATH="$HOME/.local/lib/python3.10/site-packages:$PYTHONPATH"

cd "$SERVICES"
PIDS=()

# ---- 5. 启动所有 Python 微服务 ----
echo "[2/3] 启动后端微服务..."

start_svc() {
    local name=$1 port=$2 module=$3 extra_env=$4
    local max_wait=5
    echo -n "  $name (port $port)... "
    # 检测端口占用 → 强制 kill 后再启动（优先用 fuser，无需依赖 ss）
    if fuser ${port}/tcp 2>/dev/null | grep -q .; then
        echo -n "kill old..."
        fuser -k ${port}/tcp 2>/dev/null
        sleep 1.5
    fi
    export FONT_DIR="$FONT_DIR"
    eval "$extra_env"
    setsid python3 -m uvicorn "$module" --host 0.0.0.0 --port "$port" --log-level info \
        &>/tmp/mt-svc-$name.log &
    local svc_pid=$!
    echo $svc_pid > /tmp/mt-pid-$name.txt
    
    # 等进程起来
    local waited=0
    while [ $waited -lt $max_wait ]; do
        sleep 1
        waited=$((waited + 1))
        if kill -0 "$svc_pid" 2>/dev/null; then
            PIDS+=($svc_pid)
            echo "OK (PID $svc_pid)"
            return
        fi
    done
    echo "FAIL (检查 /tmp/mt-svc-$name.log)"
}

start_svc "user-service"         8001 "user_service.main:app"
start_svc "project-service"      8002 "project_service.main:app"
start_svc "translation-service"  8003 "translation_service.main:app" \
    "export STORAGE_BASE_URL=http://localhost:8002"
start_svc "image-service"        8004 "image_service.main:app" \
    "export STORAGE_BASE_URL=http://localhost:8002"
start_svc "export-service"       8005 "export_service.main:app" \
    "export STORAGE_BASE_URL=http://localhost:8080"
start_svc "reader-service"       8006 "reader_service.main:app"
start_svc "notification-service" 8007 "notification_service.main:app"
start_svc "ai-gateway"           8100 "ai_gateway.main:app" \
    "export AI_GATEWAY_PORT=8100"

# ---- 5.5 启动 Celery Worker ----
echo -n "  Celery Worker... "
export CELERY_BROKER_URL="redis://localhost:6379/1"
export CELERY_RESULT_BACKEND="redis://localhost:6379/2"
if pgrep -f "celery.*worker" > /dev/null 2>&1; then
    echo "已运行"
else
    setsid celery -A common.tasks.celery_app worker --loglevel=info --concurrency=2 \
        &>/tmp/celery-worker.log &
    CELERY_PID=$!
    echo $CELERY_PID > /tmp/mt-pid-celery.txt
    sleep 2
    if kill -0 "$CELERY_PID" 2>/dev/null; then
        echo "OK (PID $CELERY_PID)"
    else
        echo "FAIL (检查 /tmp/celery-worker.log)"
    fi
fi

# ---- 6. 启动 Go API 网关（在 Python 服务全部就绪后启动） ----
echo "[3/4] 启动 Go API 网关..."
echo -n "  等待后端就绪..."

# 等 Python 服务全部响应
MAX_GWWAIT=20
GW_WAITED=0
while [ $GW_WAITED -lt $MAX_GWWAIT ]; do
    ok_count=0
    for port in 8001 8002 8003 8004 8005 8006 8007 8100; do
        code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}/health 2>/dev/null || echo "000")
        if [ "$code" = "200" ] || [ "$code" = "404" ] || [ "$code" = "302" ] || [ "$code" = "307" ]; then
            ok_count=$((ok_count + 1))
        fi
    done
    if [ $ok_count -ge 6 ]; then
        echo " OK"
        break
    fi
    sleep 1
    GW_WAITED=$((GW_WAITED + 1))
    echo -n "."
done
if [ $GW_WAITED -ge $MAX_GWWAIT ]; then
    echo " 超时（${ok_count}/8 服务响应），强制启动网关"
fi

echo -n "  API Gateway (8080)... "
export SERVER_PORT=8080; export GIN_MODE=release
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-your-super-secret-jwt-key-change-in-production}"
export JWT_ACCESS_TOKEN_EXPIRE="${JWT_ACCESS_TOKEN_EXPIRE:-86400}s"
export CORS_ORIGINS="http://localhost:3000,http://localhost:3001,http://localhost:5173,http://127.0.0.1:3000"
export USER_SERVICE_URL="http://127.0.0.1:8001"
export PROJECT_SERVICE_URL="http://127.0.0.1:8002"
export TRANSLATION_SERVICE_URL="http://127.0.0.1:8003"
export IMAGE_SERVICE_URL="http://127.0.0.1:8004"
export EXPORT_SERVICE_URL="http://127.0.0.1:8005"
export READER_SERVICE_URL="http://127.0.0.1:8006"
export NOTIFICATION_SERVICE_URL="http://127.0.0.1:8007"
export AI_GATEWAY_URL="http://127.0.0.1:8100"
export RATE_LIMIT_ENABLED=true
export RATE_LIMIT_USER_RPS=100; export RATE_LIMIT_USER_BURST=200
export RATE_LIMIT_IP_RPS=200; export RATE_LIMIT_IP_BURST=500

# 强制清理旧占用
fuser -k 8080/tcp 2>/dev/null; sleep 1.5

setsid "$GATEWAY_DIR/gateway_linux" &>/tmp/mt-svc-gateway.log &
GW_PID=$!
echo $GW_PID > /tmp/mt-pid-gateway.txt
sleep 2
if kill -0 "$GW_PID" 2>/dev/null; then
    echo "OK (PID $GW_PID)"
else
    echo "FAIL (检查 /tmp/mt-svc-gateway.log)"
fi

echo ""
echo "[4/4] 启动完成"
echo ""
echo "==========================================="
echo "  服务状态总览"
echo "==========================================="
echo "  基础服务:"
echo "    PostgreSQL  : localhost:5433"
echo "    Redis       : localhost:6379"
echo "    MinIO       : localhost:9000"
echo ""
echo "  后端微服务:"
echo "    用户服务    : http://localhost:8001 /docs"
echo "    项目服务    : http://localhost:8002 /docs"
echo "    翻译服务    : http://localhost:8003 /docs"
echo "    图像服务    : http://localhost:8004 /docs"
echo "    导出服务    : http://localhost:8005 /docs"
echo "    阅读器服务  : http://localhost:8006 /docs"
echo "    通知服务    : http://localhost:8007 /docs"
echo "    AI网关      : http://localhost:8100 /docs"
echo ""
echo "  API 网关 (Go):"
echo "    Go 网关     : http://localhost:8080 (前端统一入口)"
echo ""
# 前端 — setsid 防止 wsl 会话关闭时被杀
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null
cd "$PROJECT/manga-translator-web"
fuser -k 3000/tcp 2>/dev/null; sleep 1
setsid npx next dev -p 3000 -H 0.0.0.0 &>/tmp/frontend.log &
FPID=$!
echo $FPID > /tmp/mt-pid-frontend.txt
cd "$SERVICES"
echo "  前端: http://localhost:3000 (PID $FPID)"
echo ""
echo "  日志文件: /tmp/mt-svc-*.log"
echo "  PID  文件: /tmp/mt-pid-*.txt"
echo "  按 Ctrl+C 停止所有服务"
echo "==========================================="

# ---- 清理函数 ----
cleanup() {
    echo ""
    echo "正在停止所有服务..."
    for port in 3000 8001 8002 8003 8004 8005 8006 8007 8080 8100 9000; do
        fuser -k ${port}/tcp 2>/dev/null
    done
    echo "所有服务已停止"
    exit
}

trap cleanup INT TERM
# 后台进程已脱离，不 wait；按 Ctrl+C 执行 cleanup

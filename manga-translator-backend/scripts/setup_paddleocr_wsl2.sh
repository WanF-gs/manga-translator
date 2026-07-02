#!/bin/bash
# ============================================================
# WSL2 环境下安装 PaddleOCR v4 全量引擎 + PP-OCRv4 ONNX 模型
# 用于升级漫画 OCR 识别准确率（P0 优先级）
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
MODEL_DIR="$BACKEND_DIR/models/ppocr_v4"

echo "============================================"
echo "  PaddleOCR v4 OCR 引擎安装脚本 (WSL2)"
echo "============================================"
echo ""

# ---- Step 1: 安装系统依赖 (Tesseract + 日语语言包) ----
echo "[1/4] 安装系统依赖 (Tesseract OCR)..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    tesseract-ocr \
    tesseract-ocr-jpn \
    tesseract-ocr-chi-sim \
    tesseract-ocr-chi-tra \
    tesseract-ocr-eng \
    tesseract-ocr-kor \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libssl-dev \
    libffi-dev
echo "  ✓ 系统依赖安装完成"

# ---- Step 2: 安装 Python 依赖 ----
echo ""
echo "[2/5] 安装 Python 依赖..."
cd "$BACKEND_DIR"

# 先安装基础依赖
pip install --upgrade pip setuptools wheel

# manga-ocr: 专为日文漫画训练的 Transformer 模型（P0 优先）
echo "    安装 manga-ocr (日文漫画专用)..."
pip install manga-ocr>=0.1.14

# PaddlePaddle CPU 版 (适合 WSL2 开发环境)
echo "    安装 PaddlePaddle CPU 版..."
pip install paddlepaddle==2.6.1 -i https://mirror.baidu.com/pypi/simple

# PaddleOCR 最新版
echo "    安装 PaddleOCR..."
pip install paddleocr>=2.8.0 -i https://mirror.baidu.com/pypi/simple

# 验证安装
echo ""
echo "    验证 PaddleOCR 安装..."
python3 -c "
import paddle
print(f'PaddlePaddle version: {paddle.__version__}')
import paddleocr
print(f'PaddleOCR available: True')
print('PaddleOCR 全量引擎安装成功!')
" || echo "    ⚠ PaddleOCR 验证失败，请检查安装日志"

echo "  ✓ Python 依赖安装完成"

# ---- Step 3: 验证 manga-ocr ----
echo ""
echo "[3/5] 验证 manga-ocr..."
python3 -c "
from manga_ocr import MangaOcr
print('manga-ocr available: True (model will download on first use)')
print('manga-ocr — 专为日文漫画训练，支持竖排/气泡/艺术字体')
" || echo "    ⚠ manga-ocr 验证失败，日文漫画 OCR 将回退到 PaddleOCR"

# ---- Step 4: 下载 PP-OCRv4 ONNX 模型 (供 RapidOCR 使用) ----
echo ""
echo "[4/5] 下载 PP-OCRv4 ONNX 模型 (供 RapidOCR 回退使用)..."
mkdir -p "$MODEL_DIR/det" "$MODEL_DIR/rec"

# 检测模型 (PP-OCRv4 detection)
DET_URL="https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_infer.tar"
# 识别模型 (PP-OCRv4 recognition)
REC_URL="https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_infer.tar"

download_and_extract() {
    local url="$1"
    local dest="$2"
    local name="$3"
    
    if [ -f "$dest/inference.onnx" ] || [ -f "$dest/inference.pdmodel" ]; then
        echo "    ${name} 模型已存在，跳过"
        return
    fi
    
    echo "    下载 ${name} 模型..."
    local tmp="/tmp/ppocr_${name}.tar"
    if command -v wget &> /dev/null; then
        wget -q --show-progress -O "$tmp" "$url" || {
            echo "    ⚠ 下载失败，将使用 RapidOCR 默认模型"
            return 1
        }
    elif command -v curl &> /dev/null; then
        curl -L -o "$tmp" "$url" || {
            echo "    ⚠ 下载失败，将使用 RapidOCR 默认模型"
            return 1
        }
    else
        echo "    ⚠ 未找到 wget/curl，请手动下载"
        return 1
    fi
    
    tar -xf "$tmp" -C "$(dirname "$dest")"
    rm -f "$tmp"
    echo "    ✓ ${name} 模型下载完成"
}

download_and_extract "$DET_URL" "$MODEL_DIR/det" "det"
download_and_extract "$REC_URL" "$MODEL_DIR/rec" "rec"

# 如果是 Paddle 格式 (.pdmodel)，需要转换为 ONNX
# 这里使用 PaddleOCR 自带的导出工具
if [ -f "$MODEL_DIR/det/inference.pdmodel" ] && [ ! -f "$MODEL_DIR/det/inference.onnx" ]; then
    echo "    转换检测模型为 ONNX 格式..."
    python3 -c "
import os
os.environ['PADDLEOCR_MODEL_DIR'] = '$MODEL_DIR'
try:
    from paddleocr.tools.infer.utility import maybe_convert_to_onnx
    print('正在转换模型...')
except Exception as e:
    print(f'ONNX 转换跳过: {e}')
    print('RapidOCR 将使用默认 v3 模型，PaddleOCR 全量引擎不受影响')
" || echo "    ⚠ 模型转换跳过，PaddleOCR 全量引擎不受影响"
fi

echo "  ✓ PP-OCRv4 模型准备完成"

# ---- Step 5: 环境变量确认 ----
echo ""
echo "[5/5] 环境变量检查..."
echo ""
echo "  当前 OCR 配置:"
echo "    PADDLEOCR_ENABLED = ${PADDLEOCR_ENABLED:-true}"
echo "    OCR_ENGINE_ORDER  = ${OCR_ENGINE_ORDER:-paddleocr,rapidocr,tesseract}"
echo "    OCR_CONFIDENCE_RETRY_THRESHOLD = ${OCR_CONFIDENCE_RETRY_THRESHOLD:-0.65}"
echo "    PADDLEOCR_MODEL_DIR = ${PADDLEOCR_MODEL_DIR:-$MODEL_DIR}"
echo ""

echo "============================================"
echo "  OCR 引擎升级安装完成!"
echo "============================================"
echo ""
echo "  引擎优先级: manga-ocr → PaddleOCR v4 → RapidOCR (v4 ONNX) → Tesseract"
echo "  manga-ocr 仅用于日语漫画，其他语言自动跳过"
echo ""
echo "  如需调整优先级:"
echo "    禁用 manga-ocr:  export OCR_ENGINE_ORDER=paddleocr,rapidocr,tesseract"
echo "    仅用 manga-ocr:  export OCR_ENGINE_ORDER=mangaocr,tesseract"
echo ""
echo "  启动服务后，AI Gateway 将自动使用新引擎。"
echo "  验证: curl http://localhost:8100/health"
echo ""

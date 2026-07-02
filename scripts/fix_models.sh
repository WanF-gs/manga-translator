#!/bin/bash
# ============================================
# 模型兼容性修复脚本 — 在 WSL2 中执行
# 用法: bash /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/scripts/fix_models.sh
# ============================================
set -e

MODEL_DIR="/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/models"

echo "=== 第1步：校验 Python 3.10 环境 ==="
# 判断系统是否已有python3.10（源码编译存在则直接跳过apt）
if command -v python3.10 &> /dev/null
then
    echo "✅ 检测到已预装 Python3.10，跳过APT源安装步骤"
    echo "Python 3.10 版本: $(python3.10 --version)"
else
    echo "未检测到Python3.10，开始通过PPA安装..."
    sudo add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null
    sudo apt update -qq
    sudo apt install -y python3.10 python3.10-venv python3.10-dev
    echo "Python 3.10 installed: $(python3.10 --version)"
fi

echo ""
echo "=== 第2步：为 Python 3.10 安装依赖 ==="
python3.10 -m pip install --user -q \
    opencv-python-headless \
    numpy \
    Pillow \
    rapidocr-onnxruntime \
    manga-ocr \
    paddlepaddle \
    paddleocr \
    onnxruntime \
    httpx

echo "=== 第3步：验证 LaMa ONNX 模型兼容性 ==="
python3.10 -c "
import onnxruntime as ort
import os
p = '$MODEL_DIR/lama_fp32.onnx'
print(f'File: {p} ({os.path.getsize(p)//1024//1024}MB)')
try:
    s = ort.InferenceSession(p)
    inputs = [i.name for i in s.get_inputs()]
    outputs = [o.name for o in s.get_outputs()]
    print(f'LaMa OK via onnxruntime. Inputs: {inputs}, Outputs: {outputs}')
except Exception as e:
    print(f'LaMa FAILED: {e}')
    print('Trying re-download...')
    import urllib.request
    urllib.request.urlretrieve(
        'https://hf-mirror.com/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
        p + '.tmp'
    )
    os.rename(p + '.tmp', p)
    s = ort.InferenceSession(p)
    print(f'LaMa re-downloaded and OK. Size: {os.path.getsize(p)//1024//1024}MB')
"

echo ""
echo "=== 第4步：验证 PaddleOCR v3 初始化 ==="
python3.10 -c "
from paddleocr import PaddleOCR
print('PaddleOCR import OK')
det = PaddleOCR(lang='japan', use_textline_orientation=False)
print('PaddleOCR initialized OK')
"

echo ""
echo "=== 第5步：验证 CTD ONNX 模型 ==="
python3.10 -c "
import cv2
import os
p = '$MODEL_DIR/comictextdetector.pt.onnx'
net = cv2.dnn.readNetFromONNX(p)
print(f'CTD OK: {os.path.getsize(p)//1024//1024}MB via OpenCV DNN')
"

echo ""
echo "=== 第6步：验证 manga-ocr ==="
python3.10 -c "
from manga_ocr import MangaOcr
print('manga-ocr import OK (model will lazy-load on first use)')
"

echo ""
echo "=== 第7步：更新默认 Python → 3.10 ==="
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.8 2
sudo update-alternatives --set python3 /usr/bin/python3.10
echo "Default python3 now: $(python3 --version)"

echo ""
echo "=== 全部完成！模型系统已就绪 ==="
echo ""
echo "模型清单:"
ls -lh $MODEL_DIR/
echo ""
echo "重启服务即可使用:"
echo "  bash /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/start_wsl2_all.sh"

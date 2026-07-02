#!/bin/bash
echo "=== Paddle Versions ==="
python3 -c "import paddle; print('PaddlePaddle:', paddle.__version__)" 2>&1
python3 -c "import paddleocr; print('PaddleOCR:', paddleocr.__version__)" 2>&1
pip3 show paddlepaddle 2>/dev/null | grep -E "Version|Requires|Location"
pip3 show paddleocr 2>/dev/null | grep -E "Version|Requires"
echo ""
echo "=== Attempting upgrade ==="
pip3 install --user --upgrade paddlepaddle 2>&1 | tail -10
echo ""
echo "=== After upgrade ==="
python3 -c "import paddle; print('PaddlePaddle:', paddle.__version__)" 2>&1

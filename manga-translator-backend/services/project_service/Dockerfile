FROM python:3.11-slim-bookworm

WORKDIR /app

# 使用阿里云 Debian 镜像源加速 (Bookworm)
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    echo "deb http://mirrors.aliyun.com/debian bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian bookworm-backports main contrib non-free non-free-firmware" >> /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian-security bookworm-security main contrib non-free non-free-firmware" >> /etc/apt/sources.list

# 安装系统依赖
# unrar: RAR/CBR 格式解压后端（rarfile Python 库依赖此命令行工具）
# poppler-utils: PDF 预览/缩略图生成（pdftoppm, pdfinfo 等）
# fonts-noto-cjk: 中日韩字体支持（PDF/图片文字渲染）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    unrar \
    poppler-utils \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY services/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com -r /app/requirements.txt
COPY services/common /app/common
COPY services/project_service /app/service

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8002

CMD ["uvicorn", "service.main:app", "--host", "0.0.0.0", "--port", "8002"]

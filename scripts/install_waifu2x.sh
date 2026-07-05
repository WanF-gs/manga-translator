#!/bin/bash
set -e

# 检测 WSL 主机 IP
WSL_HOST_IP=$(ip route | grep default | awk '{print $3}')
echo "WSL Host IP: $WSL_HOST_IP"
echo ""

# 设置代理（Clash 局域网连接）
export http_proxy="http://${WSL_HOST_IP}:7897"
export https_proxy="http://${WSL_HOST_IP}:7897"

mkdir -p ~/.local/bin
cd ~/.local/bin

# 清理残留
rm -f waifu2x.zip
rm -rf waifu2x_tmp

# 测试代理能否访问 GitHub
echo "Testing proxy connection to GitHub..."
curl -sI https://github.com | head -3
if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: Proxy connection failed!"
    echo ""
    echo "Possible fixes:"
    echo "1. Check Clash Verge -> Settings -> LAN Connection (局域网连接) is enabled"
    echo "2. Check Windows Firewall allows Clash to accept connections from LAN"
    echo "3. Try running: sudo ufw allow from ${WSL_HOST_IP}"
    exit 1
fi

echo ""
echo "Proxy OK! Downloading waifu2x..."

# 下载
curl -L --progress-bar -o waifu2x.zip \
  "https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/20220728/waifu2x-ncnn-vulkan-20220728-ubuntu.zip"
echo "Download complete: $(ls -lh waifu2x.zip | awk '{print $5}')"

# 解压
echo "Extracting..."
python3 -c "import zipfile; zipfile.ZipFile('waifu2x.zip').extractall('waifu2x_tmp')"

# 找到并拷贝二进制
echo "Installing..."
BIN=$(find waifu2x_tmp/ -name "waifu2x-ncnn-vulkan" -type f | head -1)
if [ -z "$BIN" ]; then
    echo "ERROR: Binary not found in zip!"
    exit 1
fi
cp "$BIN" ~/.local/bin/waifu2x-ncnn-vulkan
chmod +x ~/.local/bin/waifu2x-ncnn-vulkan

# 验证
echo ""
echo "=== Installation complete ==="
~/.local/bin/waifu2x-ncnn-vulkan --version

# 清理
rm -rf waifu2x_tmp waifu2x.zip
echo "Cleaned up temp files"

#!/bin/bash
# P0 FIX: 启动 Node.js 前端（端口3000）
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 20 2>/dev/null

# 释放 3000 端口
fuser -k 3000/tcp 2>/dev/null
sleep 1

cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-web
setsid npx next dev -p 3000 -H 0.0.0.0 > /tmp/frontend.log 2>&1 &
FPID=$!
echo $FPID > /tmp/mt-pid-frontend.txt
echo "Frontend PID=$FPID"
sleep 15
ss -tlnp | grep 3000
tail -3 /tmp/frontend.log
FPID=$!
echo $FPID > /tmp/mt-pid-frontend.txt
echo "Frontend PID=$FPID"
sleep 15
ss -tlnp | grep 3000
tail -3 /tmp/frontend.log

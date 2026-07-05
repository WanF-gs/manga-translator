#!/bin/bash
# 检测 WSL 可访问的 Windows 代理端口

WSL_HOST_IP=$(ip route | grep default | awk '{print $3}')
echo "WSL Host IP: $WSL_HOST_IP"
echo ""
echo "Testing proxy ports..."
echo ""

for port in 7890 7891 7897 7898 7899 7892 7893 7894 7895 7896 8080 10808 10809 8899; do
  timeout 1 bash -c "echo >/dev/tcp/$WSL_HOST_IP/$port" 2>/dev/null && echo "OPEN: $port"
done

echo ""
echo "Done."

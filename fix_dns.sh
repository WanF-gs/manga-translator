#!/bin/bash
echo "=== Fix WSL2 DNS ==="
echo "@Wanf123789" | sudo -S sh -c 'echo "nameserver 8.8.8.8" > /etc/resolv.conf'
echo "DNS fixed:"
cat /etc/resolv.conf
echo ""
echo "=== Test DNS ==="
python3 -c "import socket; print('tmt.tencentcloudapi.com:', socket.gethostbyname('tmt.tencentcloudapi.com'))"

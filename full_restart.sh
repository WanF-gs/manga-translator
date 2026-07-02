#!/bin/bash
# Kill all old processes
for port in 8001 8002 8003 8004 8005 8006 8007 8100 8080 3000; do
    fuser -k ${port}/tcp 2>/dev/null
done
sleep 3

# Verify all clear
echo "=== Port status ==="
for port in 8001 8002 8003 8004 8005 8006 8007 8100 8080 3000; do
    alive=$(ss -tlnp 2>/dev/null | grep -c ":${port} ")
    if [ "${alive}" -gt 0 ]; then
        echo "Port ${port}: STILL ALIVE (forcing kill)..."
        fuser -k ${port}/tcp 2>/dev/null
        sleep 1
    else
        echo "Port ${port}: clear"
    fi
done

sleep 2
echo ""
echo "=== Starting all services with Python 3.10 ==="
bash /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/start_wsl2_all.sh

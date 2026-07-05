#!/bin/bash
# Check working dirs
for pid in 1712 1722; do
    echo "=== PID $pid ==="
    if [ -d "/proc/$pid" ]; then
        readlink "/proc/$pid/cwd"
        echo "cmdline:"
        cat "/proc/$pid/cmdline" | tr '\0' ' '
        echo ""
    else
        echo "PID $pid not found"
    fi
done

# Also check if code exists in home dir vs mnt dir
echo ""
echo "=== Check file locations ==="
echo "--- /mnt/c path ---"
ls -la "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services/common/tasks/vocab_extractor.py" 2>/dev/null && echo "EXISTS in /mnt/c" || echo "NOT in /mnt/c"

echo "--- /home/wanf path ---"
ls -la "/home/wanf/manga-translator-backend/services/common/tasks/vocab_extractor.py" 2>/dev/null && echo "EXISTS in /home/wanf" || echo "NOT in /home/wanf"

# Check if there's a git repo in home
echo ""
echo "=== Git repos in /home/wanf ==="
find /home/wanf -maxdepth 2 -name "*.git" -o -name ".git" 2>/dev/null | head -5

# Check PYTHONPATH
echo ""
echo "=== PYTHONPATH env for services ==="
cat /proc/1712/environ 2>/dev/null | tr '\0' '\n' | grep PYTHON || echo "Cannot read environ"

#!/usr/bin/env python3
"""Check where services are running from."""
import os, sys

# Check paths
paths = [
    "/mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend/services/common/tasks/vocab_extractor.py",
    "/home/wanf/manga-translator-backend/services/common/tasks/vocab_extractor.py",
    "/home/wanf/demo_04/manga-translator-backend/services/common/tasks/vocab_extractor.py",
]

for p in paths:
    print(f"{p}: {'EXISTS' if os.path.exists(p) else 'NOT FOUND'}")

# Check PID working dirs
import glob
for pid_dir in glob.glob("/proc/[0-9]*/"):
    try:
        pid = int(os.path.basename(pid_dir.rstrip("/")))
        if pid in [1712, 1722]:
            cwd = os.readlink(f"/proc/{pid}/cwd")
            print(f"\nPID {pid} cwd: {cwd}")
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\x00", b" ").decode()
                print(f"PID {pid} cmd: {cmd[:100]}")
    except:
        pass

# Check if vocab_extractor has my changes
for p in paths:
    if os.path.exists(p):
        with open(p) as f:
            content = f.read()
            has_translation = "word_to_translation" in content
            print(f"\n{p}:")
            print(f"  has word_to_translation: {has_translation}")

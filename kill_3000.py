#!/usr/bin/env python3
import subprocess
import time

print("=== Step 1: Windows-side kill ===")
r = subprocess.run(
    ["powershell", "-NoProfile", "-Command",
     "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | "
     "ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop; "
     "Write-Host ('Killed PID ' + $_.OwningProcess) } catch { Write-Host ('Skip PID ' + $_.OwningProcess) } }"],
    capture_output=True, text=True
)
print(r.stdout)
print("STDERR:", r.stderr[:200])

time.sleep(3)

r = subprocess.run(
    ["powershell", "-NoProfile", "-Command",
     "(Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Measure-Object).Count"],
    capture_output=True, text=True
)
print(f"Windows port 3000 count: {r.stdout.strip()}")

r = subprocess.run(["wsl", "-e", "bash", "-c",
    "ss -tlnp 2>/dev/null | grep 3000 || echo 'WSL port 3000 free'"],
    capture_output=True, text=True)
print(f"WSL port 3000: {r.stdout.strip()}")

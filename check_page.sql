Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object {
    $pid_ = $_.OwningProcess
    $addr = $_.LocalAddress
    try {
        $p = Get-Process -Id $pid_ -ErrorAction Stop
        Write-Host "$addr  PID=$pid_  Name=$($p.ProcessName)  Path=$($p.Path)"
    } catch {
        Write-Host "$addr  PID=$pid_  (inaccessible - WSL mirror or system)"
    }
}

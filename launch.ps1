# Start Resampler if it is not already up, then open it in an app window.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-Resampler {
    try {
        $request = [System.Net.WebRequest]::Create("http://127.0.0.1:8787/api/health")
        $request.Timeout = 400
        $request.Method = "GET"
        $response = $request.GetResponse()
        $response.Close()
        return $true
    } catch {
        return $false
    }
}

function Show-Fail([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, "Resampler") | Out-Null
}

if (-not (Test-Resampler)) {
    $python = $null
    foreach ($cand in @(
        (Join-Path $root ".venv\Scripts\pythonw.exe"),
        (Join-Path $root "venv\Scripts\pythonw.exe")
    )) {
        if (Test-Path $cand) { $python = $cand; break }
    }
    if (-not $python) {
        $cmd = Get-Command python -ErrorAction SilentlyContinue
        if ($cmd) {
            $pythonw = Join-Path (Split-Path $cmd.Source) "pythonw.exe"
            if (Test-Path $pythonw) { $python = $pythonw } else { $python = $cmd.Source }
        }
    }
    if (-not $python) {
        Show-Fail "Python was not found, so Resampler could not start."
        exit 1
    }
    $env:PYTHONPATH = Join-Path $root "src"
    $log = Join-Path $env:TEMP "resampler-launch.log"
    $err = Join-Path $env:TEMP "resampler-launch.err"
    Start-Process -FilePath $python -ArgumentList "-m","resample.cli","serve","--host","127.0.0.1","--port","8787" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and -not (Test-Resampler)) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Resampler)) {
        $detail = ""
        if (Test-Path $log) { $detail = Get-Content -Path $log -Raw -ErrorAction SilentlyContinue }
        if (Test-Path $err) { $detail += Get-Content -Path $err -Raw -ErrorAction SilentlyContinue }
        Show-Fail "Resampler did not start.`r`n`r`n$detail"
        exit 1
    }
}

$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $edge) {
    Show-Fail "Microsoft Edge was not found, so the Resampler window could not open."
    exit 1
}

$profile = Join-Path $env:LOCALAPPDATA "Resampler\edge"
New-Item -ItemType Directory -Force -Path $profile | Out-Null
$edgeArgs = "--app=http://127.0.0.1:8787 --user-data-dir=`"$profile`" --window-size=1280,800"
Start-Process -FilePath $edge -ArgumentList $edgeArgs

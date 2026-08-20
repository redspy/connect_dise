@echo off
cd /d %~dp0

echo [Step 1] Stopping server...
taskkill /F /IM node.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [Step 2] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    exit /b 1
)

echo [Step 3] Building frontend...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: build failed
    exit /b 1
)

echo [Step 4] Starting server...
powershell -Command "Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory '%cd%' -RedirectStandardOutput 'server.log' -RedirectStandardError 'server_error.log'"

echo [Step 5] Verifying server actually responds...
REM Start-Process는 비동기 실행이라 node가 시작 직후 크래시해도 여기까지는 항상
REM 도달함 — 실제로 :3000/ 이 200을 반환하는지 재시도 루프로 확인해야
REM "배포 성공"이 진짜 의미를 가짐(2026-08-20, 사용자 요청으로 검증 로직 부재 확인 후 추가).
powershell -Command "$ok=$false; for ($i=0; $i -lt 10; $i++) { try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {} ; Start-Sleep -Seconds 2 }; if (-not $ok) { Write-Host 'ERROR: server did not respond on :3000 after 20s'; exit 1 } else { Write-Host 'Server responded 200 OK' }"
if %ERRORLEVEL% neq 0 (
    echo ERROR: Server health check failed after deploy — see server_error.log
    type server_error.log
    exit /b 1
)

echo ========================================
echo  Deploy complete! (server verified up)
echo ========================================

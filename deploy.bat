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
REM Start-Process로 띄운 프로세스는 GitHub Actions 러너의 Job Object에 묶여서,
REM 이 배포 스텝(=job)이 끝나는 순간 러너가 자기 프로세스 트리를 정리하면서
REM 서버까지 같이 죽는 문제가 있었음(2026-08-20 실측 확인 — 헬스체크는 job 진행
REM 중이라 통과하지만, job 종료 직후 포트가 죽어있음). 과거 이 프로젝트가
REM 정확히 같은 문제를 wmic으로 해결했다가(커밋 93b7af1, "runner orphan cleanup
REM 회피") 다른 이유(D:\Source 권한 오류)로 되돌아간 이력이 git log에 있음.
REM schtasks(작업 스케줄러)로 즉시실행 태스크를 만들면 (a) 태스크 스케줄러가
REM 관리하는 완전히 독립된 프로세스라 러너 job과 무관하게 살아남고, (b) 현재
REM 로그인 계정 권한을 그대로 쓰므로 wmic이 겪었던 권한 오류도 재발하지 않는다.
schtasks /Delete /TN "ConnectDiseServer" /F >nul 2>&1
schtasks /Create /TN "ConnectDiseServer" /TR "cmd /c cd /d %cd% && node server\index.js > server.log 2>server_error.log" /SC ONCE /ST 23:59 /F >nul 2>&1
schtasks /Run /TN "ConnectDiseServer"
if %ERRORLEVEL% neq 0 (
    echo ERROR: schtasks failed to launch server task
    exit /b 1
)

echo [Step 5] Verifying server actually responds...
REM schtasks /Run도 비동기라 node가 시작 직후 크래시해도 여기까지는 항상
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

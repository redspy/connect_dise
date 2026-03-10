@echo off
echo ========================================
echo  Connect DISE - Deploy
echo ========================================

:: 1. 실행 중인 Node 서버 중지
echo [1/5] Stopping server...
taskkill /F /FI "WINDOWTITLE eq connect_dise_server" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: 2. 최신 소스 가져오기
echo [2/5] Pulling latest changes...
git pull origin main
if %ERRORLEVEL% neq 0 (
    echo ERROR: git pull failed
    exit /b 1
)

:: 3. 의존성 설치
echo [3/5] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    exit /b 1
)

:: 4. 프론트엔드 빌드
echo [4/5] Building frontend...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: build failed
    exit /b 1
)

:: 5. 서버 재시작 (백그라운드)
echo [5/5] Starting server...
start "connect_dise_server" /B node server/index.js

echo ========================================
echo  Deploy complete!
echo ========================================

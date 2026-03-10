@echo off
cd /d %~dp0

echo [Step 1] Stopping server...
taskkill /F /FI "WINDOWTITLE eq connect_dise_server" >nul 2>&1
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
start "" /b cmd /c "cd /d %~dp0 && node server/index.js > server.log 2>&1"

echo ========================================
echo  Deploy complete!
echo ========================================
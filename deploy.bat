@echo off
cd /d %~dp0

echo [Step 1] Stopping server...
taskkill /F /FI "WINDOWTITLE eq connect_dise_server" >nul 2>&1

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
start "connect_dise_server" /min /d %~dp0 node server/index.js

echo ========================================
echo  Deploy complete!
echo ========================================
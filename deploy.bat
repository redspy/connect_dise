@echo off
cd /d %~dp0

echo [Step 1] Stopping server...
call pm2 stop connect_dise >nul 2>&1
call pm2 delete connect_dise >nul 2>&1

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
call pm2 start server/index.js --name connect_dise

echo ========================================
echo  Deploy complete!
echo ========================================

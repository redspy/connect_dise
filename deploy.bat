@echo off

echo [Step 1] Stopping server...
taskkill /F /FI "WINDOWTITLE eq connect_dise_server"      


echo [Step 2] Pulling latest code...
git pull origin main

echo [Step 3] Installing dependencies...
call npm install

echo [Step 4] Starting server...
node server/index.js


echo ========================================
echo  Deploy complete!
echo ========================================
@echo off
setlocal
cd /d "%~dp0"

title NovaCart Business Launch v17.1.0

echo ==========================================
echo          NovaCart Business Launch
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not available in PATH.
  pause
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo ERROR: Docker is not installed or not in PATH.
  echo Start/install Docker Desktop, then run this file again.
  pause
  exit /b 1
)

if not exist .env (
  if exist .env.example (
    echo Creating local .env from .env.example...
    copy /Y .env.example .env >nul
  )
)

if not exist node_modules\ (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Starting PostgreSQL container...
call docker compose up -d db
if errorlevel 1 goto :fail

echo Starting NovaCart. The browser will open automatically when ready...
call npm start
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo NovaCart could not start. Review the message above.
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==============================================
echo        NovaCart v11 - Local Launcher
echo ==============================================
echo.

if not exist package.json (
  echo ERROR: package.json not found. Run this file from the extracted NovaCart folder.
  pause
  exit /b 1
)

if not exist .env (
  echo Creating .env from .env.example...
  copy /y .env.example .env >nul
  echo.
  echo IMPORTANT: Open .env and set ADMIN_EMAIL and ADMIN_PASSWORD.
  echo.
)

where docker >nul 2>nul
if errorlevel 1 (
  echo ERROR: Docker CLI is not installed or not on PATH.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo ERROR: Docker Desktop engine is not running.
  echo Open Docker Desktop, wait until it is ready, then run this launcher again.
  pause
  exit /b 1
)

echo Starting PostgreSQL...
docker compose up -d db
if errorlevel 1 (
  echo ERROR: PostgreSQL container could not be started.
  echo Another service may already own port 5432.
  pause
  exit /b 1
)

echo Waiting for PostgreSQL...
docker compose exec db pg_isready -U novacart -d novacart
if errorlevel 1 (
  echo ERROR: PostgreSQL is not accepting connections.
  pause
  exit /b 1
)

echo Running database migrations...
npm run db:migrate
if errorlevel 1 (
  echo ERROR: Database migration failed.
  pause
  exit /b 1
)

echo Seeding admin account...
npm run db:seed-admin
if errorlevel 1 (
  echo ERROR: Admin setup failed. Check ADMIN_EMAIL and ADMIN_PASSWORD in .env.
  pause
  exit /b 1
)

echo.
echo Starting NovaCart...
echo Store: http://localhost:3000
echo Admin: http://localhost:3000/admin.html
echo Press Ctrl+C in this window to stop the server.
echo.
start "NovaCart Browser" http://localhost:3000
npm start

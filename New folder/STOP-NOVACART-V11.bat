@echo off
setlocal
cd /d "%~dp0"
echo Stopping NovaCart database container...
docker compose stop db
pause

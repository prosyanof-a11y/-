@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   Снятие одного сообщения из ядра AI Trading Office
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js не найден. Установите с https://nodejs.org (LTS), затем запустите снова.
  pause
  exit /b 1
)
if not exist node_modules\ws (
  echo Устанавливаю модуль ws (один раз)...
  call npm install ws
  echo.
)
set /p OFFICE_KEY=Вставьте ваш office-ключ (X-Office-Key) и нажмите Enter:
echo.
node get-core-data.js
echo.
echo ^>^>^> Скопируйте JSON между метками ===== и вставьте его в чат с Claude.
echo.
pause

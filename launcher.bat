@echo off
setlocal EnableExtensions
REM ============================================================================
REM  MIRRA AI - one-click launcher
REM
REM    launcher.bat          start backend (8001) + MIRRA frontend (3000)
REM                          + teammate original frontend (3001), open browser
REM    launcher.bat status   show which services are running
REM    launcher.bat stop     close the windows this launcher opened
REM
REM  Each service runs in its own window; close a window to stop that service.
REM  Services already listening on their port are skipped (no duplicates).
REM ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
for %%I in ("%ROOT%\..") do set "PARENT=%%~fI"
set "TEAM=%PARENT%\Mirra-AI-teammate-main"

set "BACKEND_PORT=8001"
set "MIRRA_PORT=3000"
set "TEAM_PORT=3001"
set "CORS=http://localhost:%MIRRA_PORT%,http://127.0.0.1:%MIRRA_PORT%,http://localhost:%TEAM_PORT%,http://127.0.0.1:%TEAM_PORT%"

if /i "%~1"=="stop" goto :stop
if /i "%~1"=="status" goto :status

echo.
echo  MIRRA AI launcher
echo  Project : %ROOT%
echo.

REM ---------------------------------------------------------------- checks ----
if not exist "%ROOT%\backend\venv\Scripts\uvicorn.exe" (
  echo  [!] Backend venv not found: backend\venv
  echo      Create it first, e.g.  python -m venv backend\venv  then install requirements.
  goto :fail
)
where npm >nul 2>&1 || (echo  [!] npm not found. Install Node.js first. & goto :fail)

if not exist "%ROOT%\frontend\node_modules" (
  echo  [..] Installing MIRRA frontend packages ^(first run^)...
  pushd "%ROOT%\frontend" && call npm ci --no-audit --no-fund & popd
)

REM Teammate original version = origin/main in its own git worktree (read-only use).
if not exist "%TEAM%\frontend\package.json" (
  echo  [..] Setting up teammate original version ^(origin/main^) in:
  echo       %TEAM%
  pushd "%ROOT%"
  git fetch origin && git worktree add --detach "%TEAM%" origin/main
  popd
)
if exist "%TEAM%\frontend\package.json" (
  if not exist "%TEAM%\frontend\.env.local" if exist "%ROOT%\frontend\.env.local" copy /y "%ROOT%\frontend\.env.local" "%TEAM%\frontend\.env.local" >nul
  if not exist "%TEAM%\frontend\node_modules" (
    echo  [..] Installing teammate frontend packages ^(first run^)...
    pushd "%TEAM%\frontend" && call npm ci --no-audit --no-fund & popd
  )
)

REM --------------------------------------------------------------- launch ----
call :port %BACKEND_PORT%
if defined UP (
  echo  [=] Backend already running on :%BACKEND_PORT% - skipped
  echo      ^(if the teammate app cannot load data, restart the backend so it allows :%TEAM_PORT%^)
) else (
  echo  [+] Backend            http://localhost:%BACKEND_PORT%
  start "MIRRA Backend :%BACKEND_PORT%" /D "%ROOT%" cmd /k "set CORS_ORIGINS=%CORS%&& backend\venv\Scripts\uvicorn.exe backend.main:app --reload --port %BACKEND_PORT%"
)

call :port %MIRRA_PORT%
if defined UP (
  echo  [=] MIRRA frontend already running on :%MIRRA_PORT% - skipped
) else (
  echo  [+] MIRRA frontend     http://localhost:%MIRRA_PORT%
  start "MIRRA Frontend :%MIRRA_PORT%" /D "%ROOT%\frontend" cmd /k "npm run dev -- -p %MIRRA_PORT%"
)

if exist "%TEAM%\frontend\package.json" (
  call :port %TEAM_PORT%
  if defined UP (
    echo  [=] Teammate version already running on :%TEAM_PORT% - skipped
  ) else (
    echo  [+] Teammate original  http://localhost:%TEAM_PORT%
    start "MIRRA Teammate :%TEAM_PORT%" /D "%TEAM%\frontend" cmd /k "npx next dev -p %TEAM_PORT%"
  )
) else (
  echo  [!] Teammate version not available - skipped ^(see messages above^)
)

echo.
echo  Waiting for the MIRRA frontend to come up...
for /l %%N in (1,1,60) do (
  call :port %MIRRA_PORT%
  if defined UP goto :open
  ping -n 3 127.0.0.1 >nul
)
:open
start "" "http://localhost:%MIRRA_PORT%"
echo.
echo  Opened http://localhost:%MIRRA_PORT%   ^(teammate version: http://localhost:%TEAM_PORT%^)
echo  Stop everything:  launcher.bat stop
echo.
endlocal
exit /b 0

REM ---------------------------------------------------------------- status ----
:status
for %%P in (%BACKEND_PORT% %MIRRA_PORT% %TEAM_PORT%) do (
  call :port %%P
  call :show %%P
)
endlocal
exit /b 0

:show
if defined UP (echo  :%1  running) else (echo  :%1  stopped)
exit /b 0

REM ------------------------------------------------------------------ stop ----
:stop
echo  Stopping MIRRA windows opened by this launcher...
taskkill /FI "WINDOWTITLE eq MIRRA Backend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq MIRRA Frontend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq MIRRA Teammate*" /T /F >nul 2>&1
echo  Done. ^(Services started from your own terminals are not touched.^)
endlocal
exit /b 0

REM ------------------------------------------------------------------ util ----
:port
set "UP="
netstat -ano | findstr /r /c:":%1 .*LISTENING" >nul && set "UP=1"
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1

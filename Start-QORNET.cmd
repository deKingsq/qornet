@echo off
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 LTS with npm, then run this file again.
  pause
  exit /b 1
)
if not defined QORNET_PORT set "QORNET_PORT=4174"
set "QORNET_PAGE=/"
if /i "%~1"=="demo" set "QORNET_PAGE=/demo/"
node -e "fetch('http://127.0.0.1:'+process.env.QORNET_PORT+'/api/v1/health',{signal:AbortSignal.timeout(600)}).then(r=>r.json()).then(x=>{process.exitCode=x.status==='ok'&&x.mode==='synthetic'?0:1}).catch(()=>{process.exitCode=1})" >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:%QORNET_PORT%%QORNET_PAGE%"
  exit /b 0
)
if not exist node_modules\.bin\vite.cmd (
  call npm.cmd ci
  if errorlevel 1 goto :failed
)
call npm.cmd run build
if errorlevel 1 goto :failed
start "" /b node -e "const url='http://127.0.0.1:'+process.env.QORNET_PORT;const open=async()=>{for(let i=0;i<30;i++){try{const health=await fetch(url+'/api/v1/health',{signal:AbortSignal.timeout(400)});if(health.ok){require('node:child_process').execFile('rundll32.exe',['url.dll,FileProtocolHandler',url+process.env.QORNET_PAGE]);return}}catch{}await new Promise(r=>setTimeout(r,300))}};open()"
echo Project: http://127.0.0.1:%QORNET_PORT%/
echo Jury demo: http://127.0.0.1:%QORNET_PORT%/demo/
call npm.cmd start
if errorlevel 1 goto :failed
exit /b 0

:failed
echo QORNET could not start. See the error above.
pause
exit /b 1

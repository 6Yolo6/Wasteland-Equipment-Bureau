@echo off
setlocal
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0server.cjs" %*
if errorlevel 1 (
  echo Launch failed. See the message above.
  pause
)

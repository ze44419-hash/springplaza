@echo off
rem ============================================================
rem  Spring Plaza Cafe - cashier with SILENT printing (no Print dialog)
rem  1) Make the receipt printer the default printer in Windows.
rem  2) Start the system:  npm start   (or use your hosted address)
rem  3) Double-click this file to open the cashier.
rem  Chrome opens in its own profile, so you do NOT have to close
rem  your normal Chrome windows. Log in once in this window.
rem ============================================================
set "URL=http://localhost:3000/cashier"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Chrome was not found. Edit this file and set the CHROME path.
  pause
  exit /b 1
)
start "" "%CHROME%" --kiosk-printing --user-data-dir="%LocalAppData%\SpringPlazaPrint" --app=%URL%

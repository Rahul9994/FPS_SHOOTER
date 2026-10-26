@echo off
rem OPTIONAL helper: lets other PCs on your PRIVATE network reach the Hollow Ridge server (TCP 7777) through Windows Defender Firewall.
rem Run it ONCE by right-clicking -> "Run as administrator". It only adds one inbound rule for the Private profile; undo it with:
rem     netsh advfirewall firewall delete rule name="Hollow Ridge LAN (7777)"
rem (The first time you start the server, Windows normally asks "Allow Node.js on private networks?" - clicking Allow does the same job.)
setlocal
set PORT=7777
if not "%~1"=="" set PORT=%~1
net session >nul 2>nul
if errorlevel 1 (
  echo This needs Administrator rights. Right-click the file and choose "Run as administrator".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Hollow Ridge LAN (%PORT%)" >nul 2>nul
netsh advfirewall firewall add rule name="Hollow Ridge LAN (%PORT%)" dir=in action=allow protocol=TCP localport=%PORT% profile=private
if errorlevel 1 (echo Failed to add the rule.) else (echo Done: inbound TCP %PORT% is open on Private networks.)
echo.
echo If your Wi-Fi is classified as "Public", change it to "Private": Settings - Network and internet - Wi-Fi - your network - Network profile type.
pause

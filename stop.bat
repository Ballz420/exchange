@echo off
echo Stopping FASEM-P Exchange...
for /f "tokens=2" %%p in ('tasklist /fi "imagename eq python.exe" /fo csv /nh ^| findstr "main:app"') do taskkill /F /PID %%p 2>nul
echo Done.
pause

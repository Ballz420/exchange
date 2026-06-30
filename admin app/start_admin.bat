@echo off
title FASEM Market Admin Server

:: Go to the repo backend directory
cd /d "c:\APP\exchange_tmp\backend"

echo ======================================
echo   FASEM Market Admin - Starting Server
echo ======================================
echo.

:: Install dependencies if needed
echo Installing dependencies...
pip install -r ..\requirements.txt 2>nul
echo.

echo Starting backend server on http://localhost:8000
echo Open admin app at http://localhost:8000/docs
echo.
echo Press Ctrl+C to stop the server
echo ======================================
echo.

:: Start the server
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
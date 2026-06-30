@echo off
title FASEM-P Exchange
echo =====================================
echo   FASEM-P Exchange - Starting
echo =====================================
echo.
echo Starting backend server on http://localhost:8000
echo.
echo   Broker UI:  http://localhost:8000/broker
echo   Admin UI:   http://localhost:8000/admin-panel
echo   API Docs:   http://localhost:8000/docs
echo.
cd /d "C:\APP\cemos-mvp\backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause

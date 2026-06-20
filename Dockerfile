# Use Python 3.12 slim image
FROM python:3.12-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend
COPY backend/ ./backend/

# Set environment variables
ENV PYTHONPATH=/app
ENV DB_PATH=/app/backend/cemos.db

# Expose the port
EXPOSE 8000

# Run with uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
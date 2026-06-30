# FASEM-P Exchange Backend
FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend (flat structure: main.py, database.py, ledger.py)
COPY backend/ ./

# Environment
ENV PYTHONPATH=/app
ENV DB_PATH=/app/cemos.db

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
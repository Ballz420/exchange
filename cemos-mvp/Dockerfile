FROM python:3.12-slim
RUN groupadd -r fasem && useradd -r -g fasem fasem
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt bcrypt
COPY backend/ ./backend/
COPY Basic-broker/ ./frontend/broker/
COPY admin app/ ./frontend/admin/
ENV PYTHONPATH=/app
ENV DB_PATH=/app/data/cemos.db
ENV CORS_ORIGINS=*
ENV TOKEN_EXPIRY_HOURS=24
RUN mkdir -p /app/data && chown -R fasem:fasem /app/data
USER fasem
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

"""
CEMOS MVP + FASEM-P Server
FastAPI application entry point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers.auth import router as auth_router
from routers.rfq import router as rfq_router
from routers.trades import router as trades_router
from routers.ledger_api import router as ledger_router
from routers.fasem import router as fasem_router

# Initialize database on startup
init_db()

app = FastAPI(title="CEMOS MVP + FASEM-P", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(rfq_router)
app.include_router(trades_router)
app.include_router(ledger_router)
app.include_router(fasem_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0", "fasem": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
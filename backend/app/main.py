from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import inventory

app = FastAPI(title="InfraView", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(inventory.sites, prefix="/api/sites", tags=["sites"])
app.include_router(inventory.devices, prefix="/api/devices", tags=["devices"])
app.include_router(inventory.links, prefix="/api/links", tags=["links"])


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}

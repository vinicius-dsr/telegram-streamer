import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

from core.telegram_client import TelegramManager
from core.config_manager import load_config, session_exists
from routes.api import router as api_router
from routes.auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    mgr = TelegramManager()
    app.state.telegram_manager = mgr
    cfg = load_config()
    if session_exists() and cfg.get("api_id") and cfg.get("api_hash"):
        try:
            await mgr.connect(cfg["api_id"], cfg["api_hash"])
            if not mgr.authorized:
                await mgr.disconnect()
        except Exception:
            pass
    yield
    if mgr.connected:
        await mgr.disconnect()


app = FastAPI(title="Telegram Streamer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

app.include_router(api_router)
app.include_router(auth_router)


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


if __name__ == "__main__":
    import uvicorn
    cfg = load_config()
    host = cfg.get("host", "0.0.0.0")
    port = cfg.get("port", 8000)
    uvicorn.run("main:app", host=host, port=port, reload=True)

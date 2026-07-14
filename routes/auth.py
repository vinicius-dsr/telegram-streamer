from fastapi import APIRouter, HTTPException, Request

from core.telegram_client import TelegramManager
from core.config_manager import (
    load_config,
    save_config,
    session_exists,
    try_find_downloader_session,
)

router = APIRouter(prefix="/api/auth")


def _get_manager(request: Request) -> TelegramManager:
    return request.app.state.telegram_manager


@router.get("/status")
async def auth_status(request: Request):
    mgr = _get_manager(request)
    status = mgr.status()
    status["downloader_session"] = try_find_downloader_session() is not None
    return status


@router.post("/login")
async def login(request: Request):
    data = await request.json()
    api_id = data.get("api_id")
    api_hash = data.get("api_hash")
    phone = data.get("phone")
    if not api_id or not api_hash or not phone:
        raise HTTPException(status_code=400, detail="api_id, api_hash and phone are required")
    try:
        api_id = int(api_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="api_id must be a number")
    cfg = load_config()
    cfg.update({"api_id": api_id, "api_hash": api_hash, "phone": phone})
    save_config(cfg)
    mgr = _get_manager(request)
    try:
        if mgr.connected:
            await mgr.disconnect()
        await mgr.connect(api_id, api_hash)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection failed: {e}")
    if mgr.authorized:
        cfg.update({"api_id": api_id, "api_hash": api_hash, "phone": phone})
        save_config(cfg)
        return {"status": "authorized", "username": mgr.get_username()}
    try:
        await mgr.send_code(phone)
    except Exception as e:
        await mgr.disconnect()
        raise HTTPException(status_code=500, detail=f"Failed to send code: {e}")
    return {"status": "code_sent"}


@router.post("/code")
async def verify_code(request: Request):
    data = await request.json()
    code = data.get("code")
    phone = data.get("phone")
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    mgr = _get_manager(request)
    if not mgr.connected:
        raise HTTPException(status_code=400, detail="Not connected. Call /api/auth/login first")
    cfg = load_config()
    use_phone = phone or cfg.get("phone")
    if not use_phone:
        raise HTTPException(status_code=400, detail="phone is required")
    try:
        await mgr.sign_in(use_phone, code)
    except Exception as e:
        await mgr.disconnect()
        raise HTTPException(status_code=500, detail=f"Invalid code: {e}")
    cfg.update({"phone": use_phone})
    save_config(cfg)
    return {"status": "authorized", "username": mgr.get_username()}


@router.post("/2fa")
async def verify_2fa(request: Request):
    data = await request.json()
    password = data.get("password")
    if not password:
        raise HTTPException(status_code=400, detail="password is required")
    mgr = _get_manager(request)
    if not mgr.connected:
        raise HTTPException(status_code=400, detail="Not connected")
    try:
        await mgr.sign_in_2fa(password)
    except Exception as e:
        await mgr.disconnect()
        raise HTTPException(status_code=500, detail=f"Invalid password: {e}")
    return {"status": "authorized", "username": mgr.get_username()}


@router.post("/reuse")
async def reuse_session(request: Request):
    mgr = _get_manager(request)
    if mgr.connected:
        await mgr.disconnect()
    success = await mgr.try_reuse_downloader_session()
    if success:
        return {"status": "authorized", "username": mgr.get_username()}
    raise HTTPException(status_code=404, detail="No valid session found from Telegram-Downloader-Tools")

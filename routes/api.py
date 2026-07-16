from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from typing import Optional

from core.telegram_client import TelegramManager
from core.video_service import VideoService
from core.config_manager import (
    get_channels,
    add_channel,
    remove_channel,
    update_channel,
    get_channel,
    load_config,
    parse_tags_input,
)

router = APIRouter(prefix="/api")


def _get_manager(request: Request) -> TelegramManager:
    return request.app.state.telegram_manager


def _get_service(request: Request) -> VideoService:
    svc = request.app.state.video_service
    if not svc.client:
        raise HTTPException(status_code=401, detail="Not connected to Telegram")
    return svc


@router.get("/channels")
async def list_channels():
    return get_channels()


@router.post("/channel")
async def create_channel(request: Request):
    data = await request.json()
    channel_id = data.get("id", "").strip()
    if not channel_id:
        raise HTTPException(status_code=400, detail="Channel id is required")
    if not channel_id.startswith("@") and not channel_id.startswith("https"):
        channel_id = f"@{channel_id}"
    name = data.get("name", channel_id)
    tags = parse_tags_input(data.get("tags_raw", "")) or data.get("tags", [])
    name_line = data.get("name_line", "ultima")
    tag_groups = data.get("tag_groups", [])
    ch = add_channel(channel_id, name, tags, name_line, tag_groups)
    _get_service(request).invalidate_cache()
    return ch


@router.put("/channel/{channel_id:path}")
async def edit_channel(channel_id: str, request: Request):
    data = await request.json()
    if "tags_raw" in data:
        data["tags"] = parse_tags_input(data.pop("tags_raw"))
    updated = update_channel(channel_id, **data)
    if not updated:
        raise HTTPException(status_code=404, detail="Channel not found")
    _get_service(request).invalidate_cache(channel_id)
    return updated


@router.delete("/channel/{channel_id:path}")
async def delete_channel(channel_id: str, request: Request):
    if not remove_channel(channel_id):
        raise HTTPException(status_code=404, detail="Channel not found")
    _get_service(request).invalidate_cache(channel_id)
    return {"ok": True}


@router.get("/videos")
async def list_videos(
    request: Request,
    channel: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    service = _get_service(request)
    if not channel:
        cfg = load_config()
        channel = cfg.get("default_channel")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel specified")
    return await service.list_videos(channel, tag=tag, limit=limit, offset=offset)


@router.get("/video/{msg_id}")
async def get_video(
    msg_id: int,
    request: Request,
    channel: Optional[str] = None,
):
    service = _get_service(request)
    if not channel:
        cfg = load_config()
        channel = cfg.get("default_channel")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel specified")
    return await service.get_video_metadata(msg_id, channel)


@router.get("/stream/{msg_id}")
async def stream_video(
    msg_id: int,
    request: Request,
    channel: Optional[str] = None,
):
    service = _get_service(request)
    if not channel:
        cfg = load_config()
        channel = cfg.get("default_channel")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel specified")
    range_header = request.headers.get("range")
    return await service.stream_video(msg_id, channel, range_header=range_header)


@router.get("/thumbnail/{msg_id}")
async def get_thumbnail(
    msg_id: int,
    request: Request,
    channel: Optional[str] = None,
):
    service = _get_service(request)
    if not channel:
        cfg = load_config()
        channel = cfg.get("default_channel")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel specified")
    data = await service.get_thumbnail(msg_id, channel)
    from fastapi.responses import Response
    return Response(content=data, media_type="image/jpeg")


@router.get("/tags")
async def list_tags(
    request: Request,
    channel: Optional[str] = None,
):
    service = _get_service(request)
    if not channel:
        cfg = load_config()
        channel = cfg.get("default_channel")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel specified")
    return await service.list_tags(channel)


@router.get("/prefetch/{msg_id}")
async def prefetch_video(
    msg_id: int,
    request: Request,
    channel: Optional[str] = None,
):
    service = _get_service(request)
    if not channel:
        cfg = load_config()
        channel = cfg.get("default_channel")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel specified")
    return await service.prefetch_video(msg_id, channel)


@router.get("/progress/{msg_id}")
async def get_progress(msg_id: int, request: Request):
    service = _get_service(request)
    progress = service.get_progress(msg_id)
    return {"time": progress}


@router.post("/progress/{msg_id}")
async def save_progress(msg_id: int, request: Request):
    service = _get_service(request)
    data = await request.json()
    current_time = data.get("time", 0)
    service.save_progress(msg_id, current_time)
    return {"ok": True}

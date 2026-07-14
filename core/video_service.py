import asyncio
import io
import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeFilename

from .config_manager import get_channel, get_channels, load_config


TAG_PATTERN = re.compile(r"#(\d+)")


def extract_tags(text: str) -> List[str]:
    if not text:
        return []
    return TAG_PATTERN.findall(text)


def extract_title(text: str, name_line: str = "ultima") -> str:
    if not text:
        return "Sem titulo"
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return "Sem titulo"
    cleaned = []
    for line in lines:
        while line.startswith("="):
            line = line[1:].strip()
        cleaned.append(line)
    lines = cleaned
    mapping = {
        "primeira": 0,
        "segunda": 1,
        "terceira": 2,
        "ultima": -1,
    }
    idx = mapping.get(name_line, -1)
    return lines[idx] if abs(idx) <= len(lines) else lines[-1]


def _get_video_info(msg: Any) -> Optional[Dict[str, Any]]:
    media = msg.media
    if not media:
        return None
    video = getattr(msg, "video", None)
    doc = getattr(media, "document", None)
    if not video and not doc:
        return None
    if video and hasattr(video, "duration"):
        return {
            "size": video.size,
            "duration": video.duration or 0,
            "width": video.w or 0,
            "height": video.h or 0,
            "mime_type": video.mime_type or "video/mp4",
        }
    if not doc and video:
        doc = video
    if doc:
        mime = getattr(doc, "mime_type", "") or ""
        if not mime.startswith("video"):
            attrs = getattr(doc, "attributes", [])
            if not any(isinstance(a, DocumentAttributeVideo) for a in attrs):
                return None
        size = getattr(doc, "size", 0)
        duration = 0
        width = 0
        height = 0
        for attr in getattr(doc, "attributes", []):
            if isinstance(attr, DocumentAttributeVideo):
                duration = attr.duration or 0
                width = attr.w or 0
                height = attr.h or 0
                break
        return {
            "size": size,
            "duration": duration,
            "width": width,
            "height": height,
            "mime_type": mime or "video/mp4",
        }
    return None


def _parse_range_header(range_header: str, file_size: int) -> Tuple[int, int]:
    try:
        ranges = range_header.replace("bytes=", "").split("-")
        start = int(ranges[0]) if ranges[0] else 0
        end = int(ranges[1]) if ranges[1] else file_size - 1
    except (ValueError, IndexError):
        raise HTTPException(status_code=416, detail="Invalid Range header")
    if start > end or start >= file_size:
        raise HTTPException(status_code=416, detail="Range not satisfiable")
    end = min(end, file_size - 1)
    return start, end


def _format_duration(seconds: int) -> str:
    if seconds <= 0:
        return "0:00"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{int(h)}:{int(m):02d}:{int(s):02d}"
    return f"{int(m)}:{int(s):02d}"


def _format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


class VideoService:
    def __init__(self, client: Optional[TelegramClient] = None):
        self.client = client
        self._entity_cache: Dict[str, Any] = {}

    def set_client(self, client: TelegramClient):
        self.client = client

    async def warmup(self):
        """Pre-resolve all configured channels to avoid FloodWait on first request."""
        if not self.client:
            return
        for ch in get_channels():
            cid = ch.get("id", "")
            if cid and cid not in self._entity_cache:
                try:
                    entity = await self.client.get_input_entity(cid)
                    self._entity_cache[cid] = entity
                except Exception:
                    pass

    async def _resolve_entity(self, channel_id: str):
        if channel_id in self._entity_cache:
            return self._entity_cache[channel_id]
        if not self.client:
            raise HTTPException(status_code=503, detail="Not connected to Telegram")
        try:
            entity = await self.client.get_input_entity(channel_id)
            self._entity_cache[channel_id] = entity
            return entity
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos antes de tentar novamente",
                headers={"Retry-After": str(e.seconds)},
            )

    async def _get_message(self, msg_id: int, channel_id: str):
        entity = await self._resolve_entity(channel_id)
        msg = await self.client.get_messages(entity, ids=msg_id)
        if not msg or not msg.media:
            raise HTTPException(status_code=404, detail="Video not found")
        return msg

    def _build_metadata(self, msg: Any, channel_id: str) -> Dict[str, Any]:
        text = msg.message or ""
        channel_cfg = get_channel(channel_id)
        name_line = channel_cfg["name_line"] if channel_cfg else "ultima"
        tags = extract_tags(text)
        title = extract_title(text, name_line)
        video_info = _get_video_info(msg)
        return {
            "msg_id": msg.id,
            "title": title,
            "tags": tags,
            "caption": text,
            "date": msg.date.isoformat() if msg.date else None,
            "channel": channel_id,
            "duration": _format_duration(video_info["duration"]) if video_info else "0:00",
            "duration_seconds": video_info["duration"] if video_info else 0,
            "size": _format_size(video_info["size"]) if video_info else "0 B",
            "size_bytes": video_info["size"] if video_info else 0,
            "width": video_info["width"] if video_info else 0,
            "height": video_info["height"] if video_info else 0,
            "mime_type": video_info["mime_type"] if video_info else "video/mp4",
        }

    async def list_videos(
        self,
        channel_id: str,
        tag: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        entity = await self._resolve_entity(channel_id)
        channel_cfg = get_channel(channel_id)
        search_tag = f"#{tag}" if tag and not tag.startswith("#") else tag
        messages = []
        count = 0
        try:
            async for msg in self.client.iter_messages(entity, search=search_tag):
                if not msg.message or not msg.media:
                    continue
                video_info = _get_video_info(msg)
                if not video_info:
                    continue
                if tag and tag not in (msg.message or ""):
                    continue
                count += 1
                if count <= offset:
                    continue
                messages.append(self._build_metadata(msg, channel_id))
                if len(messages) >= limit:
                    break
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos antes de tentar novamente",
                headers={"Retry-After": str(e.seconds)},
            )
        return messages

    async def get_video_metadata(self, msg_id: int, channel_id: str) -> Dict[str, Any]:
        msg = await self._get_message(msg_id, channel_id)
        return self._build_metadata(msg, channel_id)

    async def list_tags(self, channel_id: str) -> List[Dict[str, Any]]:
        entity = await self._resolve_entity(channel_id)
        tag_counts: Dict[str, int] = {}
        try:
            async for msg in self.client.iter_messages(entity):
                if not msg.message or not msg.media:
                    continue
                video_info = _get_video_info(msg)
                if not video_info:
                    continue
                for tag in extract_tags(msg.message):
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1
        except FloodWaitError:
            pass
        return [
            {"tag": tag, "count": count}
            for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])
        ]

    async def stream_video(
        self,
        msg_id: int,
        channel_id: str,
        range_header: Optional[str] = None,
    ) -> StreamingResponse:
        msg = await self._get_message(msg_id, channel_id)
        video_info = _get_video_info(msg)
        if not video_info:
            raise HTTPException(status_code=404, detail="No video media found")
        file_size = video_info["size"]
        mime_type = video_info["mime_type"]
        if range_header:
            start, end = _parse_range_header(range_header, file_size)
            content_length = end - start + 1

            async def generate():
                async for chunk in self.client.iter_download(
                    msg.media, offset=start, request_size=content_length
                ):
                    yield chunk

            return StreamingResponse(
                generate(),
                status_code=206,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(content_length),
                    "Content-Type": mime_type,
                },
            )

        async def generate():
            async for chunk in self.client.iter_download(msg.media):
                yield chunk

        return StreamingResponse(
            generate(),
            status_code=200,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Type": mime_type,
            },
        )

    async def get_thumbnail(self, msg_id: int, channel_id: str) -> bytes:
        msg = await self._get_message(msg_id, channel_id)
        if not msg.media:
            raise HTTPException(status_code=404, detail="No media found")
        video = getattr(msg, "video", None)
        doc = getattr(msg.media, "document", None)
        thumbs = None
        if video and video.thumbs:
            thumbs = video.thumbs
        elif doc:
            for attr in getattr(doc, "attributes", []):
                if hasattr(attr, "thumbs") and attr.thumbs:
                    thumbs = attr.thumbs
                    break
        if not thumbs:
            raise HTTPException(status_code=404, detail="No thumbnail available")
        thumb = thumbs[0]
        thumb_location = getattr(thumb, "location", None)
        if not thumb_location:
            raise HTTPException(status_code=404, detail="Thumbnail not accessible")
        result = await self.client._download_file(thumb_location)
        return result

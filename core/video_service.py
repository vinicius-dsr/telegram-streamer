import asyncio
import io
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from fastapi.responses import StreamingResponse, Response
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeFilename

import aiofiles

from .config_manager import get_channel, get_channels, load_config, update_channel

_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")
_PROGRESS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".playback_progress.json")
_STREAM_CHUNK_SIZE = 1024 * 1024  # 1MB
_PREFETCH_SIZE = 2 * 1024 * 1024  # 2MB
_CACHE_MAX_BYTES = 1024 * 1024 * 1024  # 1GB total limit
_CACHE_TTL = 86400  # 24 hours
_PROGRESS_TTL = 2592000  # 30 days


TAG_PATTERN = re.compile(r"#([A-Za-z0-9]+)")


def _entity_to_channel_id(entity) -> Optional[str]:
    """Extract a stable channel ID string from a resolved Telethon entity."""
    peer = getattr(entity, "channel_id", None)
    if peer is not None:
        return str(peer)
    peer = getattr(entity, "chat_id", None)
    if peer is not None:
        return str(peer)
    peer = getattr(entity, "user_id", None)
    if peer is not None:
        return str(peer)
    return None


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
    _VIDEO_CACHE_TTL = 300   # 5 minutes
    _MSG_CACHE_TTL = 300     # 5 minutes
    _THUMB_CACHE_TTL = 1800  # 30 minutes
    _MAX_CONCURRENT = 10

    def __init__(self, client: Optional[TelegramClient] = None):
        self.client = client
        self._entity_cache: Dict[str, Any] = {}
        self._video_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
        self._msg_cache: Dict[int, Tuple[float, Any]] = {}
        self._thumb_cache: Dict[int, Tuple[float, bytes]] = {}
        self._sem = asyncio.Semaphore(self._MAX_CONCURRENT)

    def set_client(self, client: TelegramClient):
        self.client = client

    async def warmup(self):
        """Pre-resolve all configured channels. For invite links, resolve once and
        cache under the resolved numeric ID so future lookups skip the API."""
        if not self.client:
            return
        for ch in get_channels():
            cid = ch.get("id", "")
            if not cid:
                continue
            resolved_id = ch.get("resolved_id")
            if resolved_id and resolved_id in self._entity_cache:
                self._entity_cache[cid] = self._entity_cache[resolved_id]
                continue
            if cid in self._entity_cache:
                continue
            try:
                entity = await self.client.get_input_entity(cid)
                self._entity_cache[cid] = entity
                if resolved_id:
                    self._entity_cache[resolved_id] = entity
                else:
                    await self._maybe_persist_resolved_id(cid, entity)
            except FloodWaitError:
                pass
            except Exception:
                pass

    async def _resolve_entity(self, channel_id: str):
        if channel_id in self._entity_cache:
            return self._entity_cache[channel_id]
        if not self.client:
            raise HTTPException(status_code=503, detail="Not connected to Telegram")

        resolve_id = channel_id
        if channel_id.startswith("https://"):
            ch_cfg = get_channel(channel_id)
            if ch_cfg and ch_cfg.get("resolved_id"):
                resolve_id = ch_cfg["resolved_id"]
                if resolve_id in self._entity_cache:
                    self._entity_cache[channel_id] = self._entity_cache[resolve_id]
                    return self._entity_cache[resolve_id]

        try:
            async with self._sem:
                entity = await self.client.get_input_entity(resolve_id)
            self._entity_cache[channel_id] = entity
            self._entity_cache[resolve_id] = entity
            if resolve_id == channel_id:
                await self._maybe_persist_resolved_id(channel_id, entity)
            return entity
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos antes de tentar novamente",
                headers={"Retry-After": str(e.seconds)},
            )

    async def _maybe_persist_resolved_id(self, original_id: str, entity):
        """If original_id is an invite link, save the resolved numeric ID in config."""
        if original_id.startswith("https://") and not original_id.startswith("@"):
            resolved = _entity_to_channel_id(entity)
            if resolved:
                update_channel(original_id, resolved_id=resolved)
                self._entity_cache[resolved] = entity

    async def _get_message(self, msg_id: int, channel_id: str):
        now = time.time()
        if msg_id in self._msg_cache:
            cached_at, cached_msg = self._msg_cache[msg_id]
            if now - cached_at < self._MSG_CACHE_TTL:
                if not cached_msg or not cached_msg.media:
                    raise HTTPException(status_code=404, detail="Video not found")
                return cached_msg

        entity = await self._resolve_entity(channel_id)
        try:
            async with self._sem:
                msg = await self.client.get_messages(entity, ids=msg_id)
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos antes de tentar novamente",
                headers={"Retry-After": str(e.seconds)},
            )
        self._msg_cache[msg_id] = (now, msg)
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
        cache_key = channel_id
        now = time.time()
        if cache_key in self._video_cache:
            cached_at, cached_videos = self._video_cache[cache_key]
            if now - cached_at < self._VIDEO_CACHE_TTL:
                return self._filter_videos(cached_videos, tag, limit, offset)

        entity = await self._resolve_entity(channel_id)
        videos = []
        try:
            async with self._sem:
                async for msg in self.client.iter_messages(entity, limit=200):
                    if not msg.message or not msg.media:
                        continue
                    video_info = _get_video_info(msg)
                    if not video_info:
                        continue
                    videos.append(self._build_metadata(msg, channel_id))
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos antes de tentar novamente",
                headers={"Retry-After": str(e.seconds)},
            )

        self._video_cache[cache_key] = (now, videos)
        return self._filter_videos(videos, tag, limit, offset)

    def _filter_videos(self, videos: List[Dict], tag: Optional[str], limit: int, offset: int) -> List[Dict]:
        result = videos
        if tag:
            result = [v for v in result if v.get("tags") and tag in v["tags"]]
        if offset > 0:
            result = result[offset:]
        return result[:limit]

    async def get_video_metadata(self, msg_id: int, channel_id: str) -> Dict[str, Any]:
        msg = await self._get_message(msg_id, channel_id)
        return self._build_metadata(msg, channel_id)

    async def list_tags(self, channel_id: str) -> List[Dict[str, Any]]:
        videos = await self.list_videos(channel_id, limit=9999)
        tag_counts: Dict[str, int] = {}
        for v in videos:
            for tag in v.get("tags", []):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        return [
            {"tag": tag, "count": count}
            for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])
        ]

    def invalidate_cache(self, channel_id: Optional[str] = None):
        if channel_id:
            self._video_cache.pop(channel_id, None)
        else:
            self._video_cache.clear()

    @staticmethod
    def _load_progress_data() -> Dict[str, Any]:
        if not os.path.exists(_PROGRESS_FILE):
            return {}
        try:
            with open(_PROGRESS_FILE, "r") as f:
                import json
                return json.load(f)
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _save_progress_data(data: Dict[str, Any]):
        os.makedirs(os.path.dirname(_PROGRESS_FILE) or ".", exist_ok=True)
        import json
        with open(_PROGRESS_FILE, "w") as f:
            json.dump(data, f)

    def save_progress(self, msg_id: int, current_time: float):
        data = self._load_progress_data()
        key = str(msg_id)
        now = time.time()
        data[key] = {"time": current_time, "updated": now}
        stale = [k for k, v in data.items() if now - v.get("updated", 0) > _PROGRESS_TTL]
        for k in stale:
            del data[k]
        self._save_progress_data(data)

    def get_progress(self, msg_id: int) -> Optional[float]:
        data = self._load_progress_data()
        key = str(msg_id)
        if key not in data:
            return None
        entry = data[key]
        now = time.time()
        if now - entry.get("updated", 0) > _PROGRESS_TTL:
            del data[key]
            self._save_progress_data(data)
            return None
        return entry.get("time")

    @staticmethod
    def _cache_path(msg_id: int) -> str:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        return os.path.join(_CACHE_DIR, f"{msg_id}.bin")

    @staticmethod
    def _get_from_cache(msg_id: int) -> Optional[str]:
        path = VideoService._cache_path(msg_id)
        if not os.path.exists(path):
            return None
        mtime = os.path.getmtime(path)
        if time.time() - mtime > _CACHE_TTL:
            try:
                os.remove(path)
            except OSError:
                pass
            return None
        return path

    @staticmethod
    def _save_chunk_to_cache(msg_id: int, data: bytes, append: bool = False):
        path = VideoService._cache_path(msg_id)
        os.makedirs(_CACHE_DIR, exist_ok=True)
        mode = "ab" if append else "wb"
        with open(path, mode) as f:
            f.write(data)

    @staticmethod
    def _evict_cache_if_needed():
        if not os.path.isdir(_CACHE_DIR):
            return
        total = 0
        files = []
        for fname in os.listdir(_CACHE_DIR):
            fpath = os.path.join(_CACHE_DIR, fname)
            if os.path.isfile(fpath):
                size = os.path.getsize(fpath)
                mtime = os.path.getmtime(fpath)
                files.append((fpath, size, mtime))
                total += size
        if total <= _CACHE_MAX_BYTES:
            return
        files.sort(key=lambda x: x[2])
        for fpath, size, _ in files:
            if total <= _CACHE_MAX_BYTES:
                break
            try:
                os.remove(fpath)
                total -= size
            except OSError:
                pass

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
        cache_file = self._get_from_cache(msg_id)

        if cache_file:
            cache_size = os.path.getsize(cache_file)
            if cache_size < file_size:
                cache_file = None

        if cache_file:
            if range_header:
                start, end = _parse_range_header(range_header, file_size)
                content_length = end - start + 1

                async def serve_cached_range():
                    async with aiofiles.open(cache_file, "rb") as f:
                        await f.seek(start)
                        remaining = content_length
                        while remaining > 0:
                            chunk_size = min(_STREAM_CHUNK_SIZE, remaining)
                            chunk = await f.read(chunk_size)
                            if not chunk:
                                break
                            remaining -= len(chunk)
                            yield chunk

                return StreamingResponse(
                    serve_cached_range(),
                    status_code=206,
                    headers={
                        "Content-Range": f"bytes {start}-{end}/{file_size}",
                        "Accept-Ranges": "bytes",
                        "Content-Length": str(content_length),
                        "Content-Type": mime_type,
                    },
                )

            async def serve_cached_full():
                async with aiofiles.open(cache_file, "rb") as f:
                    while True:
                        chunk = await f.read(_STREAM_CHUNK_SIZE)
                        if not chunk:
                            break
                        yield chunk

            return StreamingResponse(
                serve_cached_full(),
                status_code=200,
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(file_size),
                    "Content-Type": mime_type,
                },
            )

        if range_header:
            start, end = _parse_range_header(range_header, file_size)
            content_length = end - start + 1

            async def generate():
                try:
                    async with self._sem:
                        first_chunk = True
                        async for chunk in self.client.iter_download(
                            msg.media, offset=start, request_size=_STREAM_CHUNK_SIZE
                        ):
                            if first_chunk and start == 0:
                                self._save_chunk_to_cache(msg_id, chunk, append=False)
                                first_chunk = False
                            elif first_chunk:
                                first_chunk = False
                            yield chunk
                except FloodWaitError as e:
                    raise HTTPException(
                        status_code=429,
                        detail=f"FloodWait: aguarde {e.seconds} segundos",
                        headers={"Retry-After": str(e.seconds)},
                    )

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
            try:
                async with self._sem:
                    async for chunk in self.client.iter_download(
                        msg.media, request_size=_STREAM_CHUNK_SIZE
                    ):
                        yield chunk
            except FloodWaitError as e:
                raise HTTPException(
                    status_code=429,
                    detail=f"FloodWait: aguarde {e.seconds} segundos",
                    headers={"Retry-After": str(e.seconds)},
                )

        return StreamingResponse(
            generate(),
            status_code=200,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Type": mime_type,
            },
        )

    async def prefetch_video(self, msg_id: int, channel_id: str) -> Response:
        cache_file = self._get_from_cache(msg_id)
        if cache_file:
            return Response(status_code=200, headers={"X-Cache": "HIT"})

        msg = await self._get_message(msg_id, channel_id)
        video_info = _get_video_info(msg)
        if not video_info:
            raise HTTPException(status_code=404, detail="No video media found")

        file_size = video_info["size"]
        prefetch_end = min(_PREFETCH_SIZE, file_size) - 1

        try:
            async with self._sem:
                first = True
                downloaded = 0
                async for chunk in self.client.iter_download(
                    msg.media, offset=0, request_size=_STREAM_CHUNK_SIZE
                ):
                    self._save_chunk_to_cache(msg_id, chunk, append=not first)
                    first = False
                    downloaded += len(chunk)
                    if downloaded >= _PREFETCH_SIZE:
                        break
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos",
                headers={"Retry-After": str(e.seconds)},
            )

        self._evict_cache_if_needed()
        return Response(status_code=200, headers={"X-Cache": "MISS"})

    async def get_thumbnail(self, msg_id: int, channel_id: str) -> bytes:
        now = time.time()
        if msg_id in self._thumb_cache:
            cached_at, cached_bytes = self._thumb_cache[msg_id]
            if now - cached_at < self._THUMB_CACHE_TTL:
                return cached_bytes

        msg = await self._get_message(msg_id, channel_id)
        if not msg.media:
            raise HTTPException(status_code=404, detail="No media found")
        video = getattr(msg, "video", None)
        doc = getattr(msg.media, "document", None)
        thumbs = None
        if video and video.thumbs:
            thumbs = video.thumbs
        elif doc:
            if doc.thumbs:
                thumbs = doc.thumbs
            else:
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
        try:
            async with self._sem:
                result = await self.client._download_file(thumb_location)
        except FloodWaitError as e:
            raise HTTPException(
                status_code=429,
                detail=f"FloodWait: aguarde {e.seconds} segundos",
                headers={"Retry-After": str(e.seconds)},
            )
        self._thumb_cache[msg_id] = (now, result)
        return result

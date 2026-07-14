import asyncio
import os
from typing import Optional

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError, FloodWaitError

from .config_manager import (
    BASE_DIR,
    load_config,
    save_config,
    session_exists,
    try_find_downloader_session,
    copy_session_to_project,
)


class TelegramManager:
    def __init__(self):
        self.client: Optional[TelegramClient] = None
        self.connected = False
        self.authorized = False
        self._me = None

    async def connect(self, api_id: int, api_hash: str) -> None:
        cfg = load_config()
        session_name = cfg.get("session_name", "session")
        session_path = os.path.join(BASE_DIR, session_name)
        self.client = TelegramClient(session_path, api_id, api_hash)
        await self.client.connect()
        self.connected = True
        self.authorized = await self.client.is_user_authorized()
        if self.authorized:
            self._me = await self.client.get_me()

    async def try_reuse_downloader_session(self) -> bool:
        src = try_find_downloader_session()
        if not src:
            return False
        cfg = load_config()
        if not cfg.get("api_id") or not cfg.get("api_hash"):
            return False
        copy_session_to_project(src)
        try:
            await self.connect(cfg["api_id"], cfg["api_hash"])
            if self.authorized:
                return True
            await self.disconnect()
        except Exception:
            try:
                await self.disconnect()
            except Exception:
                pass
        return False

    async def send_code(self, phone: str) -> None:
        if not self.client:
            raise RuntimeError("Client not connected")
        await self.client.send_code_request(phone)

    async def sign_in(self, phone: str, code: str) -> None:
        if not self.client:
            raise RuntimeError("Client not connected")
        await self.client.sign_in(phone, code)
        self.authorized = True
        self._me = await self.client.get_me()

    async def sign_in_2fa(self, password: str) -> None:
        if not self.client:
            raise RuntimeError("Client not connected")
        await self.client.sign_in(password=password)
        self.authorized = True
        self._me = await self.client.get_me()

    async def complete_login(self, api_id: int, api_hash: str, phone: str, code: str, password: Optional[str] = None) -> None:
        await self.connect(api_id, api_hash)
        if not self.authorized:
            await self.send_code(phone)
            try:
                await self.sign_in(phone, code)
            except SessionPasswordNeededError:
                if not password:
                    raise
                await self.sign_in_2fa(password)
        cfg = load_config()
        cfg.update({
            "api_id": api_id,
            "api_hash": api_hash,
            "phone": phone,
        })
        save_config(cfg)

    async def disconnect(self) -> None:
        if self.client and self.connected:
            try:
                await self.client.disconnect()
            except Exception:
                pass
        self.connected = False
        self.authorized = False
        self._me = None
        self.client = None

    def get_client(self) -> TelegramClient:
        if not self.client:
            raise RuntimeError("Client not connected")
        return self.client

    def get_username(self) -> str:
        if not self._me:
            return "Unknown"
        return getattr(self._me, "username", None) or getattr(self._me, "first_name", str(self._me))

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "authorized": self.authorized,
            "username": self.get_username() if self.authorized else None,
            "session_exists": session_exists(),
        }

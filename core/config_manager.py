import json
import os
from typing import Any, Dict, List, Optional
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG: Dict[str, Any] = {
    "api_id": None,
    "api_hash": None,
    "phone": None,
    "session_name": "session",
    "channels": [],
    "default_channel": None,
    "host": "0.0.0.0",
    "port": 8000,
}


def load_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            merged = {**DEFAULT_CONFIG, **cfg}
            return merged
        except (json.JSONDecodeError, OSError):
            return dict(DEFAULT_CONFIG)
    return dict(DEFAULT_CONFIG)


def save_config(cfg: Dict[str, Any]) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)


def get_session_path(session_name: Optional[str] = None) -> str:
    cfg = load_config()
    name = session_name or cfg.get("session_name", "session")
    return os.path.join(BASE_DIR, f"{name}.session")


def session_exists(session_name: Optional[str] = None) -> bool:
    return os.path.exists(get_session_path(session_name))


def try_find_downloader_session() -> Optional[str]:
    downloader_dir = os.path.join(BASE_DIR, "..", "Telegram-Downloader-Tools", "src")
    if not os.path.isdir(downloader_dir):
        return None
    for f in os.listdir(downloader_dir):
        if f.endswith(".session"):
            return os.path.join(downloader_dir, f)
    return None


def copy_session_to_project(src_path: str, session_name: Optional[str] = None) -> str:
    import shutil
    cfg = load_config()
    name = session_name or cfg.get("session_name", "session")
    dest = os.path.join(BASE_DIR, f"{name}.session")
    shutil.copy2(src_path, dest)
    journal = src_path + "-journal"
    if os.path.exists(journal):
        shutil.copy2(journal, dest + "-journal")
    return dest


def add_channel(channel_id: str, name: str, tags: List[str], name_line: str = "ultima") -> Dict[str, Any]:
    cfg = load_config()
    channel = {
        "id": channel_id,
        "name": name,
        "tags": tags,
        "name_line": name_line,
        "added_at": datetime.now().strftime("%Y-%m-%d"),
    }
    existing = [c for c in cfg["channels"] if c["id"] == channel_id]
    if existing:
        existing[0].update(channel)
    else:
        cfg["channels"].append(channel)
    if not cfg["default_channel"] and cfg["channels"]:
        cfg["default_channel"] = cfg["channels"][0]["id"]
    save_config(cfg)
    return channel


def remove_channel(channel_id: str) -> bool:
    cfg = load_config()
    before = len(cfg["channels"])
    cfg["channels"] = [c for c in cfg["channels"] if c["id"] != channel_id]
    if cfg["default_channel"] == channel_id:
        cfg["default_channel"] = cfg["channels"][0]["id"] if cfg["channels"] else None
    save_config(cfg)
    return len(cfg["channels"]) < before


def get_channel(channel_id: str) -> Optional[Dict[str, Any]]:
    cfg = load_config()
    for c in cfg["channels"]:
        if c["id"] == channel_id:
            return c
    return None


def get_channels() -> List[Dict[str, Any]]:
    return load_config().get("channels", [])


def update_channel(channel_id: str, **kwargs) -> Optional[Dict[str, Any]]:
    cfg = load_config()
    for c in cfg["channels"]:
        if c["id"] == channel_id:
            c.update({k: v for k, v in kwargs.items() if v is not None})
            save_config(cfg)
            return c
    return None

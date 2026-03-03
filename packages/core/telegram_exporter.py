#!/usr/bin/env python3
"""
MirrorAI — Telegram Auto Exporter
Tự động export chat history từ Telegram qua MTProto API (Telethon).
100% local, không gửi data đi đâu.

User chỉ cần: số điện thoại + OTP. Không cần API credentials.

Usage:
    python -m packages.core.telegram_exporter \
        --phone +84901234567 \
        --output ~/.mirrorai/data/exports
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("mirrorai.exporter")

# Built-in API credentials (standard practice for open-source Telegram clients)
# Telethon default test credentials — works for all users
DEFAULT_API_ID = 611335
DEFAULT_API_HASH = "d524b414d21f4d37f08684c1df41ac9c"


async def export_telegram_chats(
    phone: str,
    output_dir: str,
    limit: int = 5000,
    chat_filter: str = "all",
    session_dir: str = "",
    api_id: int = DEFAULT_API_ID,
    api_hash: str = DEFAULT_API_HASH,
) -> dict:
    """
    Export Telegram chat history to local JSON files.
    User chỉ cần số điện thoại — OTP sẽ được gửi qua Telegram.

    Args:
        phone: Số điện thoại (+84...)
        output_dir: Thư mục lưu export
        limit: Số tin nhắn tối đa mỗi chat
        chat_filter: "all" | "private" | "group"
        session_dir: Thư mục lưu session file
        api_id: Telegram API ID (có mặc định)
        api_hash: Telegram API Hash (có mặc định)

    Returns:
        dict với stats về export
    """
    try:
        from telethon import TelegramClient
        from telethon.tl.types import (
            User,
            Chat,
            Channel,
            Message,
            MessageMediaPhoto,
            MessageMediaDocument,
        )
    except ImportError:
        logger.error("Telethon chưa cài. Chạy: pip install telethon")
        sys.exit(1)

    # Setup paths
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    session_path = Path(session_dir or output_dir) / "mirrorai_session"

    # Log file
    log_dir = Path(output_dir).parent / "logs" if "exports" in output_dir else Path(output_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "exporter.log"
    file_handler = logging.FileHandler(str(log_file), mode="a")
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(file_handler)

    logger.info("=" * 50)
    logger.info("MirrorAI Telegram Exporter")
    logger.info(f"  Phone: {phone[:4]}***{phone[-3:]}")
    logger.info(f"  Output: {output_path}")
    logger.info(f"  Limit: {limit} messages/chat")
    logger.info(f"  Filter: {chat_filter}")
    logger.info("=" * 50)

    stats = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "chats_exported": 0,
        "total_messages": 0,
        "self_name": "",
        "self_id": "",
        "files": [],
        "errors": [],
    }

    # Connect — Telethon sẽ tự hỏi OTP qua terminal
    client = TelegramClient(str(session_path), api_id, api_hash)

    print("\n  Đang kết nối Telegram...")
    print("  (Mã OTP sẽ được gửi qua Telegram app của bạn)\n")

    await client.start(phone=phone)

    me = await client.get_me()
    self_name = f"{me.first_name or ''} {me.last_name or ''}".strip()
    self_id = str(me.id)
    stats["self_name"] = self_name
    stats["self_id"] = self_id

    logger.info(f"  ✓ Logged in: {self_name} (ID: {self_id})")
    print(f"  ✓ Đăng nhập thành công: {self_name}")

    # Get dialogs (chats)
    print("  Đang tải danh sách chat...")
    dialogs = await client.get_dialogs()
    logger.info(f"  Found {len(dialogs)} chats")
    print(f"  ✓ Tìm thấy {len(dialogs)} cuộc hội thoại\n")

    for dialog in dialogs:
        entity = dialog.entity

        # Filter chats
        is_user = isinstance(entity, User)
        is_group = isinstance(entity, (Chat, Channel))

        if chat_filter == "private" and not is_user:
            continue
        if chat_filter == "group" and not is_group:
            continue

        # Skip bots, deleted accounts
        if is_user and (getattr(entity, "bot", False) or getattr(entity, "deleted", False)):
            continue

        chat_name = dialog.name or "Unknown"
        chat_id = str(dialog.id)

        # Determine chat type
        if is_user:
            chat_type = "personal_chat"
        elif isinstance(entity, Channel):
            chat_type = "public_supergroup" if getattr(entity, "broadcast", False) else "private_supergroup"
        else:
            chat_type = "private_group"

        # Skip channels/broadcasts
        if getattr(entity, "broadcast", False):
            continue

        print(f"  [{stats['chats_exported'] + 1}] {chat_name}...", end="", flush=True)

        messages_data = []
        msg_count = 0

        try:
            async for message in client.iter_messages(entity, limit=limit):
                if not isinstance(message, Message):
                    continue
                if not message.text and not message.media:
                    continue

                msg_obj = {
                    "id": message.id,
                    "type": "message",
                    "date": message.date.isoformat() if message.date else "",
                    "date_unixtime": str(int(message.date.timestamp())) if message.date else "",
                    "from": "",
                    "from_id": "",
                    "text": "",
                    "reply_to_message_id": getattr(message.reply_to, "reply_to_msg_id", None) if message.reply_to else None,
                    "forwarded_from": None,
                }

                # Sender info
                if message.sender:
                    if isinstance(message.sender, User):
                        sender_name = f"{message.sender.first_name or ''} {message.sender.last_name or ''}".strip()
                        msg_obj["from"] = sender_name
                        msg_obj["from_id"] = f"user{message.sender.id}"
                    else:
                        msg_obj["from"] = getattr(message.sender, "title", "Unknown")
                        msg_obj["from_id"] = f"channel{message.sender.id}"

                # Text content
                if message.text:
                    msg_obj["text"] = message.text
                elif message.media:
                    if isinstance(message.media, MessageMediaPhoto):
                        msg_obj["text"] = "[Photo]"
                    elif isinstance(message.media, MessageMediaDocument):
                        msg_obj["text"] = "[Document]"
                    else:
                        msg_obj["text"] = "[Media]"

                # Forwarded
                if message.forward:
                    fwd_name = ""
                    if message.forward.sender:
                        fwd_name = getattr(message.forward.sender, "first_name", "") or ""
                    msg_obj["forwarded_from"] = fwd_name or "Unknown"

                messages_data.append(msg_obj)
                msg_count += 1

        except Exception as e:
            err_msg = f"Error exporting {chat_name}: {e}"
            logger.warning(f"  ✗ {err_msg}")
            stats["errors"].append(err_msg)
            print(f" ✗ lỗi")
            continue

        if msg_count == 0:
            print(f" (trống)")
            continue

        # Reverse to chronological order
        messages_data.reverse()

        # Build export object (Telegram Desktop compatible format)
        export_obj = {
            "name": chat_name,
            "type": chat_type,
            "id": int(chat_id) if chat_id.lstrip("-").isdigit() else chat_id,
            "messages": messages_data,
        }

        # Save to file
        safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in chat_name).strip()
        file_name = f"{safe_name}_{chat_id}.json"
        file_path = output_path / file_name

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(export_obj, f, indent=2, ensure_ascii=False)

        print(f" ✓ {msg_count} tin nhắn")

        stats["chats_exported"] += 1
        stats["total_messages"] += msg_count
        stats["files"].append({
            "chat": chat_name,
            "type": chat_type,
            "messages": msg_count,
            "file": str(file_path),
        })

    # Create combined result.json
    all_messages = []
    for file_info in stats["files"]:
        with open(file_info["file"], "r", encoding="utf-8") as f:
            data = json.load(f)
            for msg in data.get("messages", []):
                msg["_chat_name"] = file_info["chat"]
                msg["_chat_type"] = file_info["type"]
                all_messages.append(msg)

    all_messages.sort(key=lambda m: m.get("date_unixtime", "0"))

    combined_path = output_path / "result.json"
    combined_obj = {
        "name": "MirrorAI Auto Export",
        "type": "personal_chat",
        "id": 0,
        "messages": all_messages,
    }
    with open(combined_path, "w", encoding="utf-8") as f:
        json.dump(combined_obj, f, indent=2, ensure_ascii=False)

    stats["combined_file"] = str(combined_path)
    stats["finished_at"] = datetime.now(timezone.utc).isoformat()

    # Save stats
    stats_path = output_path / "export_stats.json"
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    await client.disconnect()

    print(f"\n{'='*50}")
    print(f"  ✓ Export hoàn tất!")
    print(f"    Chats: {stats['chats_exported']}")
    print(f"    Tin nhắn: {stats['total_messages']}")
    print(f"    File: {combined_path}")
    print(f"{'='*50}")

    # Output for CLI to parse
    print(f"\n__EXPORT_STATS__{json.dumps(stats)}")

    return stats


def main():
    parser = argparse.ArgumentParser(description="MirrorAI Telegram Auto Exporter")
    parser.add_argument("--phone", required=True, help="Phone number (+84...)")
    parser.add_argument("--output", default=os.path.expanduser("~/.mirrorai/data/exports"), help="Output directory")
    parser.add_argument("--limit", default=5000, type=int, help="Max messages per chat")
    parser.add_argument("--filter", default="all", choices=["all", "private", "group"], help="Chat type filter")
    parser.add_argument("--session-dir", default="", help="Session file directory")
    # Optional override (user không cần quan tâm)
    parser.add_argument("--api-id", type=int, default=DEFAULT_API_ID, help=argparse.SUPPRESS)
    parser.add_argument("--api-hash", default=DEFAULT_API_HASH, help=argparse.SUPPRESS)

    args = parser.parse_args()

    asyncio.run(
        export_telegram_chats(
            phone=args.phone,
            output_dir=args.output,
            limit=args.limit,
            chat_filter=args.filter,
            session_dir=args.session_dir,
            api_id=args.api_id,
            api_hash=args.api_hash,
        )
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
MirrorAI — Telegram Auto Exporter
Tự động export chat history từ Telegram qua MTProto API (Telethon).
100% local, không gửi data đi đâu.

Usage:
    python -m packages.core.telegram_exporter \
        --api-id 12345 \
        --api-hash abc123 \
        --phone +84901234567 \
        --output ~/.mirrorai/data/exports \
        --limit 5000
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


async def export_telegram_chats(
    api_id: int,
    api_hash: str,
    phone: str,
    output_dir: str,
    limit: int = 5000,
    chat_filter: str = "all",
    session_dir: str = "",
) -> dict:
    """
    Export Telegram chat history to local JSON files.

    Args:
        api_id: Telegram API ID (từ my.telegram.org)
        api_hash: Telegram API Hash
        phone: Số điện thoại đăng nhập
        output_dir: Thư mục lưu export
        limit: Số tin nhắn tối đa mỗi chat
        chat_filter: "all" | "private" | "group"
        session_dir: Thư mục lưu session file

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

    session_path = Path(session_dir or output_dir) / "telegram_session"

    # Log file
    log_file = output_path.parent / "logs" / "exporter.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
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
        "files": [],
        "errors": [],
    }

    # Connect
    client = TelegramClient(str(session_path), api_id, api_hash)
    await client.start(phone=phone)

    me = await client.get_me()
    self_name = f"{me.first_name or ''} {me.last_name or ''}".strip()
    self_id = str(me.id)
    logger.info(f"  Logged in as: {self_name} (ID: {self_id})")

    # Get dialogs (chats)
    logger.info("\nFetching chat list...")
    dialogs = await client.get_dialogs()
    logger.info(f"  Found {len(dialogs)} chats")

    exported_count = 0

    for dialog in dialogs:
        entity = dialog.entity

        # Filter chats
        is_user = isinstance(entity, User)
        is_group = isinstance(entity, (Chat, Channel))

        if chat_filter == "private" and not is_user:
            continue
        if chat_filter == "group" and not is_group:
            continue

        # Skip bots, deleted accounts, service chats
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

        # Skip channels/broadcasts (chỉ export chats có tin nhắn 2 chiều)
        if getattr(entity, "broadcast", False):
            continue

        logger.info(f"\n  Exporting: {chat_name} ({chat_type})...")

        messages_data = []
        msg_count = 0

        try:
            async for message in client.iter_messages(entity, limit=limit):
                if not isinstance(message, Message):
                    continue
                if not message.text and not message.media:
                    continue

                # Build message object (compatible with Telegram Desktop export format)
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

                if msg_count % 500 == 0:
                    logger.info(f"    ... {msg_count} messages")

        except Exception as e:
            err_msg = f"Error exporting {chat_name}: {e}"
            logger.warning(f"    ✗ {err_msg}")
            stats["errors"].append(err_msg)
            continue

        if msg_count == 0:
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

        logger.info(f"    ✓ {msg_count} messages → {file_name}")

        stats["chats_exported"] += 1
        stats["total_messages"] += msg_count
        stats["files"].append({
            "chat": chat_name,
            "type": chat_type,
            "messages": msg_count,
            "file": str(file_path),
        })
        exported_count += 1

    # Create combined result.json (all chats merged, Telegram Desktop compatible)
    all_messages = []
    for file_info in stats["files"]:
        with open(file_info["file"], "r", encoding="utf-8") as f:
            data = json.load(f)
            for msg in data.get("messages", []):
                msg["_chat_name"] = file_info["chat"]
                msg["_chat_type"] = file_info["type"]
                all_messages.append(msg)

    # Sort by date
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
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    await client.disconnect()

    logger.info(f"\n{'='*50}")
    logger.info(f"Export complete!")
    logger.info(f"  Chats: {stats['chats_exported']}")
    logger.info(f"  Messages: {stats['total_messages']}")
    logger.info(f"  Combined: {combined_path}")
    logger.info(f"  Stats: {stats_path}")
    if stats["errors"]:
        logger.warning(f"  Errors: {len(stats['errors'])}")
    logger.info(f"{'='*50}")

    # Output for CLI to parse
    print(f"\n__EXPORT_STATS__{json.dumps(stats)}")

    return stats


def main():
    parser = argparse.ArgumentParser(description="MirrorAI Telegram Auto Exporter")
    parser.add_argument("--api-id", required=True, type=int, help="Telegram API ID (from my.telegram.org)")
    parser.add_argument("--api-hash", required=True, help="Telegram API Hash")
    parser.add_argument("--phone", required=True, help="Phone number (+84...)")
    parser.add_argument("--output", default=os.path.expanduser("~/.mirrorai/data/exports"), help="Output directory")
    parser.add_argument("--limit", default=5000, type=int, help="Max messages per chat")
    parser.add_argument("--filter", default="all", choices=["all", "private", "group"], help="Chat type filter")
    parser.add_argument("--session-dir", default="", help="Session file directory")

    args = parser.parse_args()

    asyncio.run(
        export_telegram_chats(
            api_id=args.api_id,
            api_hash=args.api_hash,
            phone=args.phone,
            output_dir=args.output,
            limit=args.limit,
            chat_filter=args.filter,
            session_dir=args.session_dir,
        )
    )


if __name__ == "__main__":
    main()

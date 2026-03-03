#!/usr/bin/env python3
"""
MirrorAI — Telegram Auto Exporter
Tự động export chat history từ Telegram qua MTProto API (Telethon).
100% local, không gửi data đi đâu.

User chỉ cần: số điện thoại + OTP.

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
DEFAULT_API_ID = 611335
DEFAULT_API_HASH = "d524b414d21f4d37f08684c1df41ac9c"

# ── Pretty Print Helpers ──

def print_header():
    print("\n╔═══════════════════════════════════════════════════╗")
    print("║       🪞 MirrorAI — Telegram Auto Exporter        ║")
    print("║       100% Local • Dữ liệu không rời máy bạn      ║")
    print("╚═══════════════════════════════════════════════════╝\n")


def print_step(step: int, total: int, text: str):
    bar_width = 30
    filled = int(bar_width * step / total)
    bar = "█" * filled + "░" * (bar_width - filled)
    pct = int(100 * step / total)
    print(f"\n  {bar}  {pct}%  {text}")


def print_status(icon: str, text: str, indent: int = 2):
    print(f"{'  ' * indent}{icon} {text}")


def print_chat_progress(index: int, total: int, name: str, chat_type: str, msg_count: int, elapsed: float):
    """Hiển thị progress cho từng chat đang export."""
    type_icon = {"personal_chat": "👤", "private_group": "👥", "private_supergroup": "🏢"}.get(chat_type, "💬")
    bar_width = 20
    filled = int(bar_width * index / total)
    bar = "█" * filled + "░" * (bar_width - filled)
    # Truncate name nếu quá dài
    display_name = name[:25] + "..." if len(name) > 25 else name
    print(f"  {bar} [{index}/{total}] {type_icon} {display_name} — {msg_count:,} tin nhắn ({elapsed:.1f}s)")


def print_summary_table(stats: dict, duration: float):
    """Bảng tổng kết chi tiết."""
    print(f"\n  ╔══════════════════════════════════════════════════╗")
    print(f"  ║              📊 KẾT QUẢ EXPORT                    ║")
    print(f"  ╠══════════════════════════════════════════════════╣")
    print(f"  ║  👤 Tài khoản:  {stats['self_name']:<33}║")
    print(f"  ║  💬 Chats:      {stats['chats_exported']:<33}║")
    print(f"  ║  📨 Tin nhắn:   {stats['total_messages']:>10,}{'':<22}║")
    print(f"  ║  ⏱  Thời gian:  {duration:.1f}s{'':<29}║")
    print(f"  ║  📁 Dung lượng: {stats.get('file_size_mb', '?')} MB{'':<27}║")
    print(f"  ╠══════════════════════════════════════════════════╣")

    if stats.get("files"):
        print(f"  ║  📋 Chi tiết từng chat:                          ║")
        print(f"  ╠──────────────────────────────────────────────────╣")
        # Top 10 chats by message count
        sorted_files = sorted(stats["files"], key=lambda x: x["messages"], reverse=True)
        for i, f in enumerate(sorted_files[:15]):
            type_icon = {"personal_chat": "👤", "private_group": "👥", "private_supergroup": "🏢"}.get(f["type"], "💬")
            name = f["chat"][:28] + ".." if len(f["chat"]) > 28 else f["chat"]
            count = f"{f['messages']:,}"
            print(f"  ║  {type_icon} {name:<30} {count:>8} msg  ║")
        if len(sorted_files) > 15:
            print(f"  ║  ... và {len(sorted_files) - 15} chats khác{'':<30}║")

    print(f"  ╠══════════════════════════════════════════════════╣")
    print(f"  ║  📂 Output: {str(stats.get('combined_file', ''))[:36]:<37}║")
    print(f"  ║  📄 Log:    ~/.mirrorai/logs/exporter.log        ║")

    if stats.get("errors"):
        print(f"  ║  ⚠  Lỗi:    {len(stats['errors'])} chats bị lỗi{'':<27}║")

    print(f"  ╠══════════════════════════════════════════════════╣")
    print(f"  ║  ▶ Tiếp theo: mirrorai ingest                    ║")
    print(f"  ╚══════════════════════════════════════════════════╝\n")


def format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f}"


async def export_telegram_chats(
    output_dir: str,
    phone: str = "",
    limit: int = 5000,
    chat_filter: str = "all",
    session_dir: str = "",
    api_id: int = DEFAULT_API_ID,
    api_hash: str = DEFAULT_API_HASH,
) -> dict:
    """
    Export Telegram chat history to local JSON files.
    Lần đầu cần SĐT + OTP. Lần sau tự động dùng session đã lưu.
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

    total_start = time.time()

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

    print_header()

    stats = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "chats_exported": 0,
        "total_messages": 0,
        "self_name": "",
        "self_id": "",
        "files": [],
        "errors": [],
    }

    # ── Step 1: Connect ──
    print_step(1, 5, "Kết nối Telegram...")

    session_exists = session_path.with_suffix(".session").exists()

    client = TelegramClient(str(session_path), api_id, api_hash)

    if session_exists:
        print_status("🔐", "Session đã lưu — đăng nhập tự động...")
        logger.info("Using existing session")
        await client.connect()

        if not await client.is_user_authorized():
            # Session hết hạn → cần login lại
            print_status("⚠", "Session hết hạn — cần đăng nhập lại")
            if not phone:
                print_status("✗", "Cần SĐT: mirrorai export --phone +84...")
                sys.exit(1)
            print_status("📩", "Mã OTP sẽ gửi qua Telegram app...")
            print()
            await client.start(phone=phone)
        else:
            print_status("✅", "Đã kết nối (không cần OTP)")
    else:
        if not phone:
            print_status("✗", "Lần đầu cần SĐT: mirrorai export --phone +84...")
            sys.exit(1)
        masked_phone = phone[:4] + "***" + phone[-3:]
        print_status("📱", f"Số điện thoại: {masked_phone}")
        print_status("📩", "Mã OTP sẽ gửi qua Telegram app...")
        print()
        logger.info(f"First login: {masked_phone}")
        await client.start(phone=phone)

    me = await client.get_me()
    self_name = f"{me.first_name or ''} {me.last_name or ''}".strip()
    self_id = str(me.id)
    username = me.username or "N/A"
    stats["self_name"] = self_name
    stats["self_id"] = self_id

    print_status("✅", f"Đăng nhập thành công!")
    print_status("👤", f"Tên: {self_name}")
    print_status("🆔", f"ID: {self_id}")
    print_status("📛", f"Username: @{username}")
    logger.info(f"Logged in: {self_name} (@{username}, ID: {self_id})")

    # ── Step 2: Scan chats ──
    print_step(2, 5, "Quét danh sách chat...")

    dialogs = await client.get_dialogs()

    # Categorize dialogs
    private_chats = 0
    groups = 0
    channels = 0
    bots = 0
    exportable = []

    for dialog in dialogs:
        entity = dialog.entity
        is_user = isinstance(entity, User)

        if is_user:
            if getattr(entity, "bot", False):
                bots += 1
                continue
            if getattr(entity, "deleted", False):
                continue
            private_chats += 1
        elif isinstance(entity, Channel):
            if getattr(entity, "broadcast", False):
                channels += 1
                continue
            groups += 1
        elif isinstance(entity, (Chat,)):
            groups += 1
        else:
            continue

        # Apply filter
        if chat_filter == "private" and not is_user:
            continue
        if chat_filter == "group" and is_user:
            continue

        exportable.append(dialog)

    print_status("📊", f"Tổng: {len(dialogs)} mục")
    print_status("👤", f"Chat cá nhân: {private_chats}")
    print_status("👥", f"Nhóm: {groups}")
    print_status("📢", f"Kênh: {channels} (bỏ qua)")
    print_status("🤖", f"Bot: {bots} (bỏ qua)")
    print_status("📥", f"Sẽ export: {len(exportable)} chats (filter: {chat_filter})")

    logger.info(f"Dialogs: {len(dialogs)} total, {len(exportable)} exportable")

    # ── Step 3: Export messages ──
    print_step(3, 5, f"Đang export {len(exportable)} chats...")
    print()

    for idx, dialog in enumerate(exportable, 1):
        entity = dialog.entity
        is_user = isinstance(entity, User)

        chat_name = dialog.name or "Unknown"
        chat_id = str(dialog.id)

        if is_user:
            chat_type = "personal_chat"
        elif isinstance(entity, Channel):
            chat_type = "private_supergroup"
        else:
            chat_type = "private_group"

        chat_start = time.time()
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

                if message.sender:
                    if isinstance(message.sender, User):
                        sender_name = f"{message.sender.first_name or ''} {message.sender.last_name or ''}".strip()
                        msg_obj["from"] = sender_name
                        msg_obj["from_id"] = f"user{message.sender.id}"
                    else:
                        msg_obj["from"] = getattr(message.sender, "title", "Unknown")
                        msg_obj["from_id"] = f"channel{message.sender.id}"

                if message.text:
                    msg_obj["text"] = message.text
                elif message.media:
                    if isinstance(message.media, MessageMediaPhoto):
                        msg_obj["text"] = "[Photo]"
                    elif isinstance(message.media, MessageMediaDocument):
                        msg_obj["text"] = "[Document]"
                    else:
                        msg_obj["text"] = "[Media]"

                if message.forward:
                    fwd_name = ""
                    if message.forward.sender:
                        fwd_name = getattr(message.forward.sender, "first_name", "") or ""
                    msg_obj["forwarded_from"] = fwd_name or "Unknown"

                messages_data.append(msg_obj)
                msg_count += 1

        except Exception as e:
            err_msg = f"Error exporting {chat_name}: {e}"
            logger.warning(err_msg)
            stats["errors"].append(err_msg)
            print_chat_progress(idx, len(exportable), chat_name, chat_type, 0, time.time() - chat_start)
            print_status("⚠", f"Lỗi: {str(e)[:60]}", indent=3)
            continue

        chat_elapsed = time.time() - chat_start

        if msg_count == 0:
            print_chat_progress(idx, len(exportable), chat_name, chat_type, 0, chat_elapsed)
            continue

        # Reverse to chronological order
        messages_data.reverse()

        export_obj = {
            "name": chat_name,
            "type": chat_type,
            "id": int(chat_id) if chat_id.lstrip("-").isdigit() else chat_id,
            "messages": messages_data,
        }

        safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in chat_name).strip()
        file_name = f"{safe_name}_{chat_id}.json"
        file_path = output_path / file_name

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(export_obj, f, indent=2, ensure_ascii=False)

        print_chat_progress(idx, len(exportable), chat_name, chat_type, msg_count, chat_elapsed)

        stats["chats_exported"] += 1
        stats["total_messages"] += msg_count
        stats["files"].append({
            "chat": chat_name,
            "type": chat_type,
            "messages": msg_count,
            "file": str(file_path),
        })

        logger.info(f"Exported: {chat_name} ({chat_type}) — {msg_count} messages in {chat_elapsed:.1f}s")

    # ── Step 4: Merge files ──
    print_step(4, 5, "Gộp dữ liệu...")

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

    # File size
    file_size = combined_path.stat().st_size
    stats["file_size_mb"] = format_size(file_size)
    stats["combined_file"] = str(combined_path)
    stats["finished_at"] = datetime.now(timezone.utc).isoformat()

    print_status("✅", f"Gộp {stats['total_messages']:,} tin nhắn → result.json ({stats['file_size_mb']} MB)")

    # ── Step 5: Save & Cleanup ──
    print_step(5, 5, "Lưu kết quả...")

    stats_path = output_path / "export_stats.json"
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    print_status("💾", f"Stats: {stats_path}")
    print_status("📄", f"Log: {log_file}")

    await client.disconnect()
    print_status("🔌", "Đã ngắt kết nối Telegram")

    total_duration = time.time() - total_start
    logger.info(f"Export complete: {stats['chats_exported']} chats, {stats['total_messages']} messages in {total_duration:.1f}s")

    # ── Summary ──
    print_summary_table(stats, total_duration)

    # Output for CLI to parse
    print(f"__EXPORT_STATS__{json.dumps(stats)}")

    return stats


def main():
    parser = argparse.ArgumentParser(description="MirrorAI Telegram Auto Exporter")
    parser.add_argument("--phone", default="", help="Phone number (+84...) — chỉ cần lần đầu")
    parser.add_argument("--output", default=os.path.expanduser("~/.mirrorai/data/exports"), help="Output directory")
    parser.add_argument("--limit", default=5000, type=int, help="Max messages per chat")
    parser.add_argument("--filter", default="all", choices=["all", "private", "group"], help="Chat type filter")
    parser.add_argument("--session-dir", default="", help="Session file directory")
    parser.add_argument("--api-id", type=int, default=DEFAULT_API_ID, help=argparse.SUPPRESS)
    parser.add_argument("--api-hash", default=DEFAULT_API_HASH, help=argparse.SUPPRESS)

    args = parser.parse_args()

    asyncio.run(
        export_telegram_chats(
            output_dir=args.output,
            phone=args.phone,
            limit=args.limit,
            chat_filter=args.filter,
            session_dir=args.session_dir,
            api_id=args.api_id,
            api_hash=args.api_hash,
        )
    )


if __name__ == "__main__":
    main()

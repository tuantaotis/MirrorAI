"""
MirrorAI — Message Normalizer.
Converts platform-specific message formats into UniversalMessage.
"""

from dataclasses import dataclass, field
from typing import Optional
import json
import logging

logger = logging.getLogger("mirrorai.normalizer")


@dataclass
class MessageContext:
    reply_to: Optional[str] = None
    thread_id: str = ""
    is_group: bool = False
    thread_name: Optional[str] = None


@dataclass
class UniversalMessage:
    id: str
    platform: str
    timestamp: str  # ISO8601
    author_id: str
    text: str
    context: MessageContext = field(default_factory=MessageContext)
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "platform": self.platform,
            "timestamp": self.timestamp,
            "author_id": self.author_id,
            "text": self.text,
            "context": {
                "reply_to": self.context.reply_to,
                "thread_id": self.context.thread_id,
                "is_group": self.context.is_group,
                "thread_name": self.context.thread_name,
            },
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "UniversalMessage":
        ctx = data.get("context", {})
        return cls(
            id=data["id"],
            platform=data["platform"],
            timestamp=data["timestamp"],
            author_id=data["author_id"],
            text=data["text"],
            context=MessageContext(
                reply_to=ctx.get("reply_to"),
                thread_id=ctx.get("thread_id", ""),
                is_group=ctx.get("is_group", False),
                thread_name=ctx.get("thread_name"),
            ),
            metadata=data.get("metadata", {}),
        )


def normalize_telegram_export(export_path: str, self_name: str) -> list[UniversalMessage]:
    """Parse Telegram Desktop JSON export into UniversalMessage list."""
    with open(export_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    messages: list[UniversalMessage] = []
    chat_list = data.get("chats", {}).get("list", [])

    for chat in chat_list:
        chat_id = chat.get("id", 0)
        chat_name = chat.get("name", "Unknown")
        is_group = chat.get("type", "") != "personal_chat"

        for msg in chat.get("messages", []):
            if msg.get("type") != "message":
                continue

            # Skip forwarded
            if msg.get("forwarded_from"):
                continue

            # Filter by author
            from_name = msg.get("from", "")
            if from_name != self_name:
                continue

            # Extract text
            text_raw = msg.get("text", "")
            if isinstance(text_raw, list):
                text = "".join(
                    e.get("text", "") if isinstance(e, dict) else str(e) for e in text_raw
                )
            else:
                text = str(text_raw)

            text = text.strip()
            if not text:
                continue

            messages.append(
                UniversalMessage(
                    id=f"tg_{chat_id}_{msg.get('id', 0)}",
                    platform="telegram",
                    timestamp=msg.get("date", ""),
                    author_id=msg.get("from_id", self_name),
                    text=text,
                    context=MessageContext(
                        reply_to=str(msg["reply_to_message_id"])
                        if msg.get("reply_to_message_id")
                        else None,
                        thread_id=str(chat_id),
                        is_group=is_group,
                        thread_name=chat_name,
                    ),
                    metadata={"chat_type": chat.get("type")},
                )
            )

    logger.info(f"Normalized {len(messages)} messages from {len(chat_list)} Telegram chats")
    return messages


def load_messages_from_jsonl(path: str) -> list[UniversalMessage]:
    """Load UniversalMessages from a JSONL file."""
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                messages.append(UniversalMessage.from_dict(json.loads(line)))
    return messages


def save_messages_to_jsonl(messages: list[UniversalMessage], path: str) -> None:
    """Save UniversalMessages to a JSONL file."""
    with open(path, "w", encoding="utf-8") as f:
        for msg in messages:
            f.write(json.dumps(msg.to_dict(), ensure_ascii=False) + "\n")
    logger.info(f"Saved {len(messages)} messages to {path}")

"""
MirrorAI — Message Cleaner.
Filters out noise: spam, too-short messages, media-only, system messages.
"""

import re
import logging
from typing import Optional

from .normalizer import UniversalMessage

logger = logging.getLogger("mirrorai.cleaner")

# Patterns to remove
SYSTEM_PATTERNS = [
    r"^/start$",
    r"^/help$",
    r"^/stop$",
    r"^\[sticker\]$",
    r"^\[photo\]$",
    r"^\[video\]$",
    r"^\[voice message\]$",
    r"^\[file\]$",
    r"^\[GIF\]$",
    r"^\[Poll\]",
    r"^You (joined|left|added|removed)",
    r"^(Group|Channel) (created|renamed|photo)",
]

COMPILED_SYSTEM = [re.compile(p, re.IGNORECASE) for p in SYSTEM_PATTERNS]


def is_system_message(text: str) -> bool:
    """Check if message is a system/service message."""
    return any(p.match(text) for p in COMPILED_SYSTEM)


def count_words(text: str) -> int:
    """Count words — handles Vietnamese (no spaces between some words)."""
    return len(text.split())


def clean_text(text: str) -> str:
    """Light cleaning: normalize whitespace, remove excessive newlines."""
    # Normalize whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def clean_messages(
    messages: list[UniversalMessage],
    min_words: int = 3,
    self_id: Optional[str] = None,
) -> list[UniversalMessage]:
    """
    Filter and clean messages.

    Rules:
    - Remove system/service messages
    - Remove messages shorter than min_words
    - Remove media-only messages (no text)
    - If self_id provided, only keep messages from self
    - Clean text (normalize whitespace)
    """
    original_count = len(messages)
    cleaned: list[UniversalMessage] = []

    stats = {
        "total": original_count,
        "system": 0,
        "too_short": 0,
        "wrong_author": 0,
        "kept": 0,
    }

    for msg in messages:
        # Filter by author
        if self_id and msg.author_id != self_id:
            stats["wrong_author"] += 1
            continue

        # Skip system messages
        if is_system_message(msg.text):
            stats["system"] += 1
            continue

        # Clean text
        cleaned_text = clean_text(msg.text)

        # Skip too short
        if count_words(cleaned_text) < min_words:
            stats["too_short"] += 1
            continue

        msg.text = cleaned_text
        cleaned.append(msg)
        stats["kept"] += 1

    logger.info(
        f"Cleaned: {stats['kept']}/{stats['total']} kept "
        f"(system={stats['system']}, short={stats['too_short']}, "
        f"wrong_author={stats['wrong_author']})"
    )
    return cleaned

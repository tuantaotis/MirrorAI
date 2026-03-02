"""
MirrorAI — Conversation-aware Chunker.
Groups messages into chunks preserving Q&A pairs and conversation context.
"""

import logging
from dataclasses import dataclass, field

from .normalizer import UniversalMessage

logger = logging.getLogger("mirrorai.chunker")


@dataclass
class Chunk:
    id: str
    text: str
    messages: list[UniversalMessage]
    metadata: dict = field(default_factory=dict)

    @property
    def word_count(self) -> int:
        return len(self.text.split())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "metadata": {
                **self.metadata,
                "message_count": len(self.messages),
                "platforms": list({m.platform for m in self.messages}),
                "date_range": {
                    "start": self.messages[0].timestamp if self.messages else "",
                    "end": self.messages[-1].timestamp if self.messages else "",
                },
            },
        }


def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~1.3 tokens per word for Vietnamese/English mixed text."""
    return int(len(text.split()) * 1.3)


def chunk_messages(
    messages: list[UniversalMessage],
    chunk_size: int = 512,
    chunk_overlap: int = 50,
) -> list[Chunk]:
    """
    Chunk messages into groups suitable for embedding.

    Strategy:
    - Group by thread (conversation context)
    - Within each thread, sliding window with overlap
    - Preserve Q&A pairs: keep reply + original together
    - Each chunk targets ~chunk_size tokens
    """
    # Sort by timestamp
    sorted_msgs = sorted(messages, key=lambda m: m.timestamp)

    # Group by thread
    threads: dict[str, list[UniversalMessage]] = {}
    for msg in sorted_msgs:
        tid = msg.context.thread_id or "default"
        if tid not in threads:
            threads[tid] = []
        threads[tid].append(msg)

    chunks: list[Chunk] = []
    chunk_id = 0

    def _make_chunk(msgs: list[UniversalMessage], tid: str, cid: int) -> Chunk:
        return Chunk(
            id=f"chunk_{cid}",
            text="\n".join(m.text for m in msgs),
            messages=list(msgs),
            metadata={
                "thread_id": tid,
                "thread_name": msgs[0].context.thread_name or "",
                "is_group": msgs[0].context.is_group,
            },
        )

    for thread_id, thread_msgs in threads.items():
        current_msgs: list[UniversalMessage] = []
        msg_token_cache: list[int] = []
        current_tokens = 0

        for msg in thread_msgs:
            msg_tokens = estimate_tokens(msg.text)

            # If adding this message would exceed chunk_size, emit current chunk
            if current_tokens + msg_tokens > chunk_size and current_msgs:
                chunks.append(_make_chunk(current_msgs, thread_id, chunk_id))
                chunk_id += 1

                # Overlap: keep last N tokens worth of messages
                overlap_tokens = 0
                overlap_start = len(current_msgs)
                for i in range(len(current_msgs) - 1, -1, -1):
                    overlap_tokens += msg_token_cache[i]
                    if overlap_tokens >= chunk_overlap:
                        overlap_start = i
                        break

                current_msgs = current_msgs[overlap_start:]
                msg_token_cache = msg_token_cache[overlap_start:]
                current_tokens = sum(msg_token_cache)

            current_msgs.append(msg)
            msg_token_cache.append(msg_tokens)
            current_tokens += msg_tokens

        # Emit final chunk for this thread
        if current_msgs:
            chunks.append(_make_chunk(current_msgs, thread_id, chunk_id))
            chunk_id += 1

    logger.info(
        f"Chunked {len(messages)} messages → {len(chunks)} chunks "
        f"(avg {sum(c.word_count for c in chunks) // max(len(chunks), 1)} words/chunk)"
    )
    return chunks

"""
MirrorAI — Corpus Statistics.
Compute basic stats from message corpus for persona profiling.
"""

import re
from collections import Counter
from dataclasses import dataclass, field

from ..data_pipeline.normalizer import UniversalMessage


# Common Vietnamese emoji
EMOJI_PATTERN = re.compile(
    "["
    "\U0001f600-\U0001f64f"  # emoticons
    "\U0001f300-\U0001f5ff"  # symbols & pictographs
    "\U0001f680-\U0001f6ff"  # transport & map
    "\U0001f1e0-\U0001f1ff"  # flags
    "\U00002702-\U000027b0"
    "\U000024c2-\U0001f251"
    "]+",
    flags=re.UNICODE,
)


@dataclass
class CorpusStats:
    total_messages: int = 0
    total_words: int = 0
    avg_word_count: float = 0.0
    median_word_count: float = 0.0
    word_counts: list[int] = field(default_factory=list)
    top_words: list[tuple[str, int]] = field(default_factory=list)
    top_bigrams: list[tuple[str, int]] = field(default_factory=list)
    top_emojis: list[tuple[str, int]] = field(default_factory=list)
    emoji_frequency: float = 0.0  # ratio of messages containing emoji
    uses_periods: float = 0.0  # ratio of messages ending with period
    uses_ellipsis: float = 0.0  # ratio containing "..."
    question_frequency: float = 0.0  # ratio containing "?"
    platforms: dict[str, int] = field(default_factory=dict)
    capitalization: str = "mixed"  # "lower" | "proper" | "mixed"


def compute_stats(messages: list[UniversalMessage]) -> CorpusStats:
    """Compute comprehensive corpus statistics."""
    stats = CorpusStats()
    stats.total_messages = len(messages)

    if not messages:
        return stats

    all_words: list[str] = []
    word_counts: list[int] = []
    emoji_counter: Counter = Counter()
    msgs_with_emoji = 0
    msgs_with_period = 0
    msgs_with_ellipsis = 0
    msgs_with_question = 0
    upper_starts = 0

    for msg in messages:
        text = msg.text
        words = text.split()
        wc = len(words)
        word_counts.append(wc)
        all_words.extend(w.lower() for w in words)

        # Platform count
        stats.platforms[msg.platform] = stats.platforms.get(msg.platform, 0) + 1

        # Emoji
        emojis = EMOJI_PATTERN.findall(text)
        if emojis:
            msgs_with_emoji += 1
            for e in emojis:
                for char in e:
                    emoji_counter[char] += 1

        # Punctuation patterns
        if text.rstrip().endswith("."):
            msgs_with_period += 1
        if "..." in text or "…" in text:
            msgs_with_ellipsis += 1
        if "?" in text:
            msgs_with_question += 1
        if text and text[0].isupper():
            upper_starts += 1

    n = len(messages)
    stats.word_counts = word_counts
    stats.total_words = sum(word_counts)
    stats.avg_word_count = stats.total_words / n
    sorted_wc = sorted(word_counts)
    stats.median_word_count = sorted_wc[n // 2]

    # Top words (filter stopwords-like short words)
    word_freq = Counter(w for w in all_words if len(w) > 1)
    stats.top_words = word_freq.most_common(50)

    # Bigrams
    bigrams: list[str] = []
    for msg in messages:
        words = msg.text.lower().split()
        for i in range(len(words) - 1):
            bigrams.append(f"{words[i]} {words[i + 1]}")
    stats.top_bigrams = Counter(bigrams).most_common(30)

    # Emoji stats
    stats.top_emojis = emoji_counter.most_common(20)
    stats.emoji_frequency = msgs_with_emoji / n

    # Punctuation ratios
    stats.uses_periods = msgs_with_period / n
    stats.uses_ellipsis = msgs_with_ellipsis / n
    stats.question_frequency = msgs_with_question / n

    # Capitalization style
    upper_ratio = upper_starts / n
    if upper_ratio > 0.8:
        stats.capitalization = "proper"
    elif upper_ratio < 0.2:
        stats.capitalization = "lower"
    else:
        stats.capitalization = "mixed"

    return stats

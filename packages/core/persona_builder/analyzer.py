"""
MirrorAI — Persona Analyzer.
Analyzes corpus to extract persona traits: writing style, vocabulary,
tone, topics, response patterns.
"""

import json
import logging
from dataclasses import dataclass, field, asdict

from ..data_pipeline.normalizer import UniversalMessage
from .stats import compute_stats, CorpusStats

logger = logging.getLogger("mirrorai.analyzer")


@dataclass
class WritingStyle:
    avg_word_count: float = 0.0
    median_word_count: float = 0.0
    capitalization: str = "mixed"
    uses_periods: float = 0.0
    uses_ellipsis: float = 0.0
    message_length_category: str = "medium"  # "short" | "medium" | "long"


@dataclass
class Vocabulary:
    top_words: list[str] = field(default_factory=list)
    unique_phrases: list[str] = field(default_factory=list)
    filler_words: list[str] = field(default_factory=list)


@dataclass
class ToneProfile:
    formality: str = "casual"  # "formal" | "casual" | "mixed"
    humor_indicators: float = 0.0
    question_tendency: float = 0.0
    emoji_usage: str = "moderate"  # "heavy" | "moderate" | "rare" | "none"
    top_emojis: list[str] = field(default_factory=list)


@dataclass
class PersonaProfile:
    name: str = ""
    writing_style: WritingStyle = field(default_factory=WritingStyle)
    vocabulary: Vocabulary = field(default_factory=Vocabulary)
    tone: ToneProfile = field(default_factory=ToneProfile)
    topics: list[str] = field(default_factory=list)
    total_messages: int = 0
    platforms: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
        logger.info(f"[Persona] Saved profile to {path}")


# Vietnamese filler words / informal markers
VIETNAMESE_FILLERS = [
    "ừ", "ờ", "à", "ạ", "nha", "nhé", "nè", "hen", "ha", "hả",
    "dạ", "vâng", "ok", "oke", "okie", "okê", "thôi", "thui",
    "z", "v", "dc", "đc", "ko", "k", "hong", "hông", "hem",
]

HUMOR_MARKERS = [
    "haha", "hihi", "hehe", "lol", "lmao", "rofl", "kk", "wkwk",
    "🤣", "😂", "😆", "😹", "💀",
]


class PersonaAnalyzer:
    """Analyze message corpus and produce a PersonaProfile."""

    def analyze(self, messages: list[UniversalMessage], user_name: str = "") -> PersonaProfile:
        """Run full persona analysis on a message corpus."""
        if not messages:
            logger.warning("[PersonaAnalyzer] Empty corpus, returning default profile")
            return PersonaProfile(name=user_name)

        # Compute base stats
        stats = compute_stats(messages)

        profile = PersonaProfile(
            name=user_name,
            total_messages=stats.total_messages,
            platforms=stats.platforms,
        )

        # Writing style
        profile.writing_style = self._analyze_writing_style(stats)

        # Vocabulary
        profile.vocabulary = self._analyze_vocabulary(stats, messages)

        # Tone
        profile.tone = self._analyze_tone(stats, messages)

        # Topics (simple TF-IDF based)
        profile.topics = self._extract_topics(messages)

        logger.info(
            f"[PersonaAnalyzer] Analyzed {stats.total_messages} messages → "
            f"style={profile.writing_style.message_length_category}, "
            f"tone={profile.tone.formality}, "
            f"topics={profile.topics[:3]}"
        )
        return profile

    def _analyze_writing_style(self, stats: CorpusStats) -> WritingStyle:
        avg = stats.avg_word_count
        if avg < 8:
            length_cat = "short"
        elif avg < 20:
            length_cat = "medium"
        else:
            length_cat = "long"

        return WritingStyle(
            avg_word_count=round(avg, 1),
            median_word_count=stats.median_word_count,
            capitalization=stats.capitalization,
            uses_periods=round(stats.uses_periods, 3),
            uses_ellipsis=round(stats.uses_ellipsis, 3),
            message_length_category=length_cat,
        )

    def _analyze_vocabulary(
        self, stats: CorpusStats, messages: list[UniversalMessage]
    ) -> Vocabulary:
        # Top words
        top_words = [w for w, _ in stats.top_words[:20]]

        # Unique phrases (bigrams)
        unique_phrases = [p for p, c in stats.top_bigrams if c >= 3][:15]

        # Filler words used
        all_text = " ".join(m.text.lower() for m in messages)
        fillers = [f for f in VIETNAMESE_FILLERS if f" {f} " in f" {all_text} "]

        return Vocabulary(
            top_words=top_words,
            unique_phrases=unique_phrases,
            filler_words=fillers,
        )

    def _analyze_tone(
        self, stats: CorpusStats, messages: list[UniversalMessage]
    ) -> ToneProfile:
        # Emoji usage
        ef = stats.emoji_frequency
        if ef > 0.5:
            emoji_usage = "heavy"
        elif ef > 0.2:
            emoji_usage = "moderate"
        elif ef > 0.05:
            emoji_usage = "rare"
        else:
            emoji_usage = "none"

        # Humor
        all_text_lower = " ".join(m.text.lower() for m in messages)
        humor_count = sum(1 for marker in HUMOR_MARKERS if marker in all_text_lower)
        humor_score = min(1.0, humor_count / max(len(messages), 1) * 10)

        # Formality (heuristic: period usage + capitalization + no fillers)
        formality_score = stats.uses_periods * 0.4 + (1 if stats.capitalization == "proper" else 0) * 0.3
        formality = "formal" if formality_score > 0.5 else "casual"

        top_emojis = [e for e, _ in stats.top_emojis[:8]]

        return ToneProfile(
            formality=formality,
            humor_indicators=round(humor_score, 3),
            question_tendency=round(stats.question_frequency, 3),
            emoji_usage=emoji_usage,
            top_emojis=top_emojis,
        )

    def _extract_topics(self, messages: list[UniversalMessage]) -> list[str]:
        """Simple topic extraction using word frequency clustering."""
        # Aggregate text
        from collections import Counter

        word_counter: Counter = Counter()
        for msg in messages:
            words = msg.text.lower().split()
            # Only meaningful words (>3 chars)
            word_counter.update(w for w in words if len(w) > 3)

        # Top topics = most frequent meaningful words
        # In production, use TF-IDF + KMeans from scikit-learn
        topics = [word for word, count in word_counter.most_common(20) if count >= 5]
        return topics[:10]

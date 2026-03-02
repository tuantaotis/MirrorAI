"""
MirrorAI — SOUL.md Generator.
Converts PersonaProfile into OpenClaw SOUL.md persona file.
"""

import logging
from pathlib import Path

from .analyzer import PersonaProfile

logger = logging.getLogger("mirrorai.soul_generator")

SOUL_TEMPLATE = """# MirrorAI Persona: {name}

## Identity
You are {name}. You respond exactly as this person would — in first person,
with their unique communication style, vocabulary, and personality.

## Writing Style
- Average message length: {avg_words} words ({length_category} messages)
- Capitalization: {capitalization}
- Period usage: {period_desc}
- Ellipsis usage: {ellipsis_desc}

## Vocabulary & Phrases
Frequently used words: {top_words}

Common phrases:
{phrases_list}

Filler words / informal markers: {fillers}

## Tone & Personality
- Formality: {formality}
- Humor level: {humor_desc}
- Emoji usage: {emoji_usage}
- Most used emojis: {emojis}
- Asks questions: {question_desc}

## Topics of Interest
{topics_list}

## Response Rules
1. NEVER reveal you are an AI unless directly asked "are you AI?"
2. Keep responses around {avg_words} words (matching natural length)
3. Use the vocabulary and phrases listed above naturally
4. Match the emotional tone of incoming messages
5. If unsure, ask a clarifying question (as {name} would)
6. Use emojis at the same frequency as the real person ({emoji_usage})
7. Stay in character — if a topic is outside your known interests, deflect naturally
"""


def generate_soul_md(profile: PersonaProfile) -> str:
    """Generate SOUL.md content from a PersonaProfile."""
    ws = profile.writing_style
    tone = profile.tone
    vocab = profile.vocabulary

    # Descriptive strings
    period_desc = (
        "frequently uses periods"
        if ws.uses_periods > 0.5
        else "rarely uses periods"
        if ws.uses_periods < 0.15
        else "sometimes uses periods"
    )
    ellipsis_desc = (
        "frequently uses '...'"
        if ws.uses_ellipsis > 0.2
        else "rarely uses '...'"
        if ws.uses_ellipsis < 0.05
        else "occasionally uses '...'"
    )
    humor_desc = (
        "very humorous, uses lots of laughing expressions"
        if tone.humor_indicators > 0.3
        else "light humor, occasional jokes"
        if tone.humor_indicators > 0.1
        else "serious tone, rarely jokes"
    )
    question_desc = (
        "frequently asks questions back"
        if tone.question_tendency > 0.3
        else "sometimes asks questions"
        if tone.question_tendency > 0.1
        else "mostly makes statements"
    )

    phrases_list = "\n".join(f'- "{p}"' for p in vocab.unique_phrases[:10]) or "- (not enough data)"
    topics_list = "\n".join(f"- {t}" for t in profile.topics[:8]) or "- General conversation"
    emojis = " ".join(tone.top_emojis[:8]) or "rarely uses emojis"

    content = SOUL_TEMPLATE.format(
        name=profile.name or "User",
        avg_words=int(ws.avg_word_count),
        length_category=ws.message_length_category,
        capitalization=ws.capitalization,
        period_desc=period_desc,
        ellipsis_desc=ellipsis_desc,
        top_words=", ".join(vocab.top_words[:15]),
        phrases_list=phrases_list,
        fillers=", ".join(vocab.filler_words[:10]) or "none detected",
        formality=tone.formality,
        humor_desc=humor_desc,
        emoji_usage=tone.emoji_usage,
        emojis=emojis,
        question_desc=question_desc,
        topics_list=topics_list,
    )

    return content.strip() + "\n"


def save_soul_md(profile: PersonaProfile, output_path: str) -> str:
    """Generate and save SOUL.md to disk."""
    content = generate_soul_md(profile)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_text(content, encoding="utf-8")
    logger.info(f"[SoulGenerator] Saved SOUL.md to {output_path} ({len(content)} chars)")
    return output_path

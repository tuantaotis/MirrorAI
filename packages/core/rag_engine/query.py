"""
MirrorAI — RAG Query Engine.
Orchestrates: retrieval → prompt assembly → LLM generation → confidence check.
This is the core brain of MirrorAI.
"""

import json
import logging
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from .retriever import Retriever, RetrievedContext

logger = logging.getLogger("mirrorai.query")


@dataclass
class QueryResult:
    response: str
    confidence: float
    contexts_used: int
    model: str
    latency_ms: int
    should_auto_reply: bool


class RAGQueryEngine:
    """
    The core MirrorAI engine.
    Takes an incoming message → retrieves context → generates persona response.
    """

    def __init__(
        self,
        retriever: Retriever,
        soul_md_path: str = "",
        confidence_threshold: float = 0.65,
        model: str = "ollama/qwen2.5:14b",
        temperature: float = 0.8,
    ):
        self.retriever = retriever
        self.confidence_threshold = confidence_threshold
        self.model = model
        self.temperature = temperature

        # Load SOUL.md persona
        self.persona_prompt = ""
        if soul_md_path and Path(soul_md_path).exists():
            self.persona_prompt = Path(soul_md_path).read_text(encoding="utf-8")
            logger.info(f"[RAGQuery] Loaded persona from {soul_md_path}")

    def query(
        self,
        incoming_message: str,
        conversation_history: str = "",
        sender_name: str = "Unknown",
    ) -> QueryResult:
        """
        Process an incoming message and generate a persona-matching response.

        Flow:
        1. Retrieve similar past messages from vector DB
        2. Calculate confidence score
        3. Assemble prompt (SOUL.md + retrieved context + conversation history)
        4. Call LLM via Ollama/OpenClaw
        5. Return result with confidence and auto-reply flag
        """
        start = time.time()

        # Step 1: Retrieve context
        contexts = self.retriever.retrieve(
            query=incoming_message,
            conversation_history=conversation_history,
        )

        # Step 2: Confidence check
        confidence = self.retriever.get_confidence(contexts)

        # Step 3: Assemble prompt
        prompt = self._build_prompt(incoming_message, contexts, conversation_history, sender_name)

        # Step 4: Generate response
        response = self._call_llm(prompt)

        latency = int((time.time() - start) * 1000)

        result = QueryResult(
            response=response,
            confidence=confidence,
            contexts_used=len(contexts),
            model=self.model,
            latency_ms=latency,
            should_auto_reply=confidence >= self.confidence_threshold,
        )

        logger.info(
            f"[RAGQuery] confidence={confidence:.3f}, "
            f"auto_reply={result.should_auto_reply}, "
            f"latency={latency}ms, model={self.model}"
        )
        return result

    def _build_prompt(
        self,
        incoming: str,
        contexts: list[RetrievedContext],
        history: str,
        sender: str,
    ) -> str:
        """Assemble the full prompt for the LLM."""
        parts = []

        # System: Persona
        if self.persona_prompt:
            parts.append(f"[PERSONA]\n{self.persona_prompt}")

        # Retrieved context
        if contexts:
            context_lines = []
            for i, ctx in enumerate(contexts, 1):
                context_lines.append(f"{i}. \"{ctx.text[:200]}\"")
            parts.append(
                "[SIMILAR PAST MESSAGES]\n"
                "These are messages you sent in similar situations:\n"
                + "\n".join(context_lines)
            )

        # Conversation history
        if history:
            parts.append(f"[RECENT CONVERSATION]\n{history[-1000:]}")

        # Current message
        parts.append(
            f"[INCOMING MESSAGE FROM {sender}]\n{incoming}\n\n"
            "[INSTRUCTION]\n"
            "Reply to this message exactly as you would — matching your writing style, "
            "tone, length, and vocabulary from your persona. "
            "Only output the message text, nothing else."
        )

        return "\n\n".join(parts)

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM. Supports Ollama local and falls back gracefully."""
        provider, model_name = self.model.split("/", 1) if "/" in self.model else ("ollama", self.model)

        if provider == "ollama":
            return self._call_ollama(model_name, prompt)
        else:
            # For cloud providers, delegate to OpenClaw agent runtime
            # This is a simplified direct call; in production, uses OpenClaw gateway
            logger.warning(
                f"[RAGQuery] Cloud provider '{provider}' — "
                "use OpenClaw gateway for production routing"
            )
            return self._call_ollama(model_name, prompt)

    def _call_ollama(self, model: str, prompt: str) -> str:
        """Direct Ollama API call."""
        base_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        try:
            resp = httpx.post(
                f"{base_url}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": self.temperature,
                        "num_predict": 256,
                    },
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            return resp.json().get("response", "").strip()
        except Exception as e:
            logger.error(f"[RAGQuery] Ollama call failed: {e}")
            return "[MirrorAI: LLM unavailable — message queued for manual review]"

    def add_response_delay(self, response: str) -> float:
        """
        Calculate human-like typing delay based on response length.
        Returns delay in seconds.
        """
        words = len(response.split())
        typing_speed_wpm = random.uniform(35, 65)
        delay_s = (words / typing_speed_wpm) * 60
        delay_s = max(0.8, min(8.0, delay_s))
        return delay_s

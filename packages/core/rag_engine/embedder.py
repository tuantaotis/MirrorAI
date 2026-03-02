"""
MirrorAI — Embedding Engine.
Supports Ollama (local) and OpenAI (cloud) embedding providers.
Provider-agnostic interface — switch via config, zero code change.
"""

import logging
import os
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger("mirrorai.embedder")


class BaseEmbedder(ABC):
    """Abstract embedding provider."""

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @abstractmethod
    def embed_single(self, text: str) -> list[float]:
        ...


class OllamaEmbedder(BaseEmbedder):
    """Local embedding via Ollama API."""

    def __init__(self, model: str = "nomic-embed-text", base_url: str | None = None):
        self.model = model
        self.base_url = base_url or os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.client = httpx.Client(timeout=60.0)
        logger.info(f"[OllamaEmbedder] model={model}, url={self.base_url}")

    def embed_single(self, text: str) -> list[float]:
        resp = self.client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.model, "input": text},
        )
        resp.raise_for_status()
        data = resp.json()
        # Ollama returns {"embeddings": [[...]]}
        return data["embeddings"][0]

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = self.client.post(
            f"{self.base_url}/api/embed",
            json={"model": self.model, "input": texts},
        )
        resp.raise_for_status()
        return resp.json()["embeddings"]


class OpenAIEmbedder(BaseEmbedder):
    """Cloud embedding via OpenAI API."""

    def __init__(self, model: str = "text-embedding-ada-002", api_key: str | None = None):
        self.model = model
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.client = httpx.Client(
            timeout=30.0,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        logger.info(f"[OpenAIEmbedder] model={model}")

    def embed_single(self, text: str) -> list[float]:
        return self.embed([text])[0]

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = self.client.post(
            "https://api.openai.com/v1/embeddings",
            json={"model": self.model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()
        # Sort by index to maintain order
        sorted_data = sorted(data["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in sorted_data]


def create_embedder(provider: str = "ollama", model: str | None = None) -> BaseEmbedder:
    """Factory: create embedder by provider name."""
    if provider == "ollama":
        return OllamaEmbedder(model=model or "nomic-embed-text")
    elif provider == "openai":
        return OpenAIEmbedder(model=model or "text-embedding-ada-002")
    else:
        raise ValueError(f"Unknown embedding provider: {provider}. Use 'ollama' or 'openai'.")

"""
MirrorAI — Configuration loader.
Loads from mirrorai.config.yaml + .env with environment variable overrides.
"""

import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import yaml
from dotenv import load_dotenv


@dataclass
class EmbeddingConfig:
    provider: str = "ollama"
    model: str = "nomic-embed-text"
    openai_model: str = "text-embedding-ada-002"
    batch_size: int = 100


@dataclass
class VectorDBConfig:
    provider: str = "chromadb"
    url: str = "http://localhost:8000"
    collection: str = "user_messages"


@dataclass
class PipelineConfig:
    chunk_size: int = 512
    chunk_overlap: int = 50
    min_message_words: int = 3
    max_history_days: int = 365


@dataclass
class PersonaConfig:
    confidence_threshold: float = 0.65
    response_delay_min_ms: int = 800
    response_delay_max_ms: int = 8000
    auto_reply: bool = True
    manual_review_queue: bool = True
    update_interval_min: int = 30


@dataclass
class ModelConfig:
    primary: str = "ollama/qwen2.5:14b"
    fallback: str = "anthropic/claude-sonnet-4-6"
    temperature: float = 0.8


@dataclass
class MirrorAIConfig:
    data_dir: str = "~/.mirrorai"
    log_level: str = "info"
    model: ModelConfig = field(default_factory=ModelConfig)
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    vectordb: VectorDBConfig = field(default_factory=VectorDBConfig)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    persona: PersonaConfig = field(default_factory=PersonaConfig)

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).expanduser()

    @property
    def logs_path(self) -> Path:
        return self.data_path / "logs"

    @property
    def state_file(self) -> Path:
        return self.data_path / "state.json"


def load_config(config_path: Optional[str] = None) -> MirrorAIConfig:
    """Load configuration from YAML file + environment variables."""
    # Load .env
    env_path = Path.home() / ".mirrorai" / ".env"
    if env_path.exists():
        load_dotenv(env_path)

    # Load YAML config
    if config_path is None:
        candidates = [
            Path("config/mirrorai.config.yaml"),
            Path.home() / ".mirrorai" / "config.yaml",
        ]
        for p in candidates:
            if p.exists():
                config_path = str(p)
                break

    config = MirrorAIConfig()

    if config_path and Path(config_path).exists():
        with open(config_path) as f:
            raw = yaml.safe_load(f) or {}

        # Map YAML → dataclass
        if "app" in raw:
            config.data_dir = raw["app"].get("data_dir", config.data_dir)
            config.log_level = raw["app"].get("log_level", config.log_level)

        if "model" in raw:
            config.model.primary = raw["model"].get("primary", config.model.primary)
            config.model.fallback = raw["model"].get("fallback", config.model.fallback)
            config.model.temperature = raw["model"].get("temperature", config.model.temperature)

        if "embedding" in raw:
            config.embedding.provider = raw["embedding"].get("provider", config.embedding.provider)
            config.embedding.model = raw["embedding"].get("model", config.embedding.model)
            config.embedding.batch_size = raw["embedding"].get(
                "batch_size", config.embedding.batch_size
            )

        if "vectordb" in raw:
            config.vectordb.url = raw["vectordb"].get("url", config.vectordb.url)
            config.vectordb.collection = raw["vectordb"].get(
                "collection", config.vectordb.collection
            )

        if "pipeline" in raw:
            for k in ("chunk_size", "chunk_overlap", "min_message_words", "max_history_days"):
                if k in raw["pipeline"]:
                    setattr(config.pipeline, k, raw["pipeline"][k])

        if "persona" in raw:
            for k in (
                "confidence_threshold",
                "response_delay_min_ms",
                "response_delay_max_ms",
                "auto_reply",
                "manual_review_queue",
                "update_interval_min",
            ):
                if k in raw["persona"]:
                    setattr(config.persona, k, raw["persona"][k])

    # Environment variable overrides
    if os.getenv("OLLAMA_URL"):
        pass  # Used by embedder directly
    if os.getenv("CHROMADB_URL"):
        config.vectordb.url = os.getenv("CHROMADB_URL", config.vectordb.url)
    if os.getenv("LOG_LEVEL"):
        config.log_level = os.getenv("LOG_LEVEL", config.log_level)

    return config

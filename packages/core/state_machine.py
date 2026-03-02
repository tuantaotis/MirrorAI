"""
MirrorAI — State Machine.
Manages application state transitions with persistence.
"""

import json
import logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mirrorai.state")


class State(str, Enum):
    UNINITIALIZED = "UNINITIALIZED"
    INSTALLING_DEPS = "INSTALLING_DEPS"
    CONFIGURING_PLATFORM = "CONFIGURING_PLATFORM"
    COLLECTING_DATA = "COLLECTING_DATA"
    PROCESSING_DATA = "PROCESSING_DATA"
    BUILDING_PERSONA = "BUILDING_PERSONA"
    INDEXING_VECTORS = "INDEXING_VECTORS"
    READY = "READY"
    MIRRORING_ACTIVE = "MIRRORING_ACTIVE"
    PAUSED = "PAUSED"
    UPDATING_PERSONA = "UPDATING_PERSONA"
    ERROR = "ERROR"


# Valid state transitions
TRANSITIONS: dict[State, list[State]] = {
    State.UNINITIALIZED: [State.INSTALLING_DEPS],
    State.INSTALLING_DEPS: [State.CONFIGURING_PLATFORM, State.ERROR],
    State.CONFIGURING_PLATFORM: [State.COLLECTING_DATA, State.ERROR],
    State.COLLECTING_DATA: [State.PROCESSING_DATA, State.ERROR],
    State.PROCESSING_DATA: [State.BUILDING_PERSONA, State.ERROR],
    State.BUILDING_PERSONA: [State.INDEXING_VECTORS, State.ERROR],
    State.INDEXING_VECTORS: [State.READY, State.ERROR],
    State.READY: [State.MIRRORING_ACTIVE, State.COLLECTING_DATA],
    State.MIRRORING_ACTIVE: [State.PAUSED, State.UPDATING_PERSONA, State.READY, State.ERROR],
    State.PAUSED: [State.MIRRORING_ACTIVE, State.READY],
    State.UPDATING_PERSONA: [State.MIRRORING_ACTIVE, State.ERROR],
    State.ERROR: [
        State.CONFIGURING_PLATFORM,
        State.COLLECTING_DATA,
        State.INSTALLING_DEPS,
        State.READY,
    ],
}


@dataclass
class PlatformState:
    enabled: bool = False
    configured: bool = False
    message_count: int = 0
    last_sync: Optional[str] = None


@dataclass
class AppState:
    state: str = State.UNINITIALIZED.value
    platforms: dict[str, dict] = field(default_factory=dict)
    model: str = "ollama/qwen2.5:14b"
    created_at: str = ""
    updated_at: str = ""
    error: Optional[str] = None
    vectors_count: int = 0
    persona_built: bool = False


class StateMachine:
    """Persistent state machine for MirrorAI."""

    def __init__(self, state_file: str):
        self.state_file = Path(state_file)
        self._state = self._load()

    def _load(self) -> AppState:
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text(encoding="utf-8"))
                state = AppState(**{k: v for k, v in data.items() if k in AppState.__dataclass_fields__})
                return state
            except Exception as e:
                logger.error(f"Failed to load state: {e}")
        return AppState()

    def _save(self) -> None:
        from datetime import datetime

        self._state.updated_at = datetime.now().isoformat()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(
            json.dumps(asdict(self._state), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    @property
    def current(self) -> State:
        return State(self._state.state)

    @property
    def data(self) -> AppState:
        return self._state

    def transition(self, to: State, error: Optional[str] = None) -> bool:
        """
        Attempt a state transition.
        Returns True if transition is valid and was applied.
        """
        current = self.current
        valid_targets = TRANSITIONS.get(current, [])

        if to not in valid_targets:
            logger.warning(
                f"Invalid transition: {current.value} → {to.value}. "
                f"Valid: {[s.value for s in valid_targets]}"
            )
            return False

        logger.info(f"State transition: {current.value} → {to.value}")
        self._state.state = to.value
        self._state.error = error if to == State.ERROR else None
        self._save()
        return True

    def force_state(self, to: State) -> None:
        """Force a state transition (bypass validation). Use with caution."""
        logger.warning(f"Forced state: {self._state.state} → {to.value}")
        self._state.state = to.value
        self._save()

    def set_platform(self, platform: str, enabled: bool, configured: bool = False) -> None:
        self._state.platforms[platform] = {
            "enabled": enabled,
            "configured": configured,
        }
        self._save()

    def set_model(self, model: str) -> None:
        self._state.model = model
        self._save()

    def update_vectors_count(self, count: int) -> None:
        self._state.vectors_count = count
        self._save()

    def set_persona_built(self, built: bool = True) -> None:
        self._state.persona_built = built
        self._save()

"""
MirrorAI — Logging Configuration.
Pretty terminal output + file logging.
"""

import logging
import sys
from pathlib import Path
from datetime import datetime


class PrettyFormatter(logging.Formatter):
    """Color-coded terminal formatter."""

    COLORS = {
        "DEBUG": "\033[36m",     # Cyan
        "INFO": "\033[32m",      # Green
        "WARNING": "\033[33m",   # Yellow
        "ERROR": "\033[31m",     # Red
        "CRITICAL": "\033[41m",  # Red background
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        timestamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        module = record.name.split(".")[-1]

        prefix = f"{color}[{timestamp}][{module}]{self.RESET}"
        message = record.getMessage()

        if record.exc_info:
            if not record.exc_text:
                record.exc_text = self.formatException(record.exc_info)
            message += f"\n{record.exc_text}"

        return f"{prefix} {message}"


class FileFormatter(logging.Formatter):
    """JSON-like file formatter for structured logging."""

    def format(self, record: logging.LogRecord) -> str:
        import json

        entry = {
            "ts": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "module": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info and record.exc_info[1]:
            entry["error"] = str(record.exc_info[1])
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(
    level: str = "info",
    log_dir: str | None = None,
) -> None:
    """
    Configure MirrorAI logging.
    - Pretty colored output to terminal
    - Structured JSON to log files
    """
    root = logging.getLogger("mirrorai")
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Clear existing handlers
    root.handlers.clear()

    # Terminal handler
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(PrettyFormatter())
    root.addHandler(console)

    # File handler
    if log_dir:
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)

        file_handler = logging.FileHandler(
            log_path / "mirrorai.log",
            encoding="utf-8",
        )
        file_handler.setFormatter(FileFormatter())
        root.addHandler(file_handler)

        # Separate error log
        error_handler = logging.FileHandler(
            log_path / "error.log",
            encoding="utf-8",
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(FileFormatter())
        root.addHandler(error_handler)

    root.info(f"Logging initialized: level={level}, dir={log_dir}")

"""Environment-driven configuration.

Secrets (the Blynk device token and the operator API key) live only here, on
the server. They are stored as ``SecretStr`` so they never appear in reprs,
logs or API responses.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import dotenv_values
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .datastreams import resolve_pin_map

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILES = (BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env")


class Thresholds(BaseSettings):
    """Display and alert thresholds. Editable at runtime from Settings."""

    model_config = SettingsConfigDict(env_prefix="THRESHOLD_", env_file=ENV_FILES, extra="ignore")

    obstacle_warning_cm: float = Field(50, gt=0, le=1000)
    obstacle_critical_cm: float = Field(20, gt=0, le=1000)
    battery_warning_pct: float = Field(20, ge=0, le=100)
    battery_critical_pct: float = Field(10, ge=0, le=100)
    battery_min_voltage: float = Field(10.5, ge=0, le=60)
    soh_warning_pct: float = Field(70, ge=0, le=100)
    # Dynamic acceleration = | |a| - 9.81 m/s² |, i.e. acceleration beyond gravity.
    abnormal_accel_ms2: float = Field(15, gt=0, le=160)
    abnormal_gyro_dps: float = Field(250, gt=0, le=2000)

    @field_validator("obstacle_critical_cm")
    @classmethod
    def _critical_below_warning(cls, v: float, info):  # noqa: ANN001
        warn = info.data.get("obstacle_warning_cm")
        if warn is not None and v >= warn:
            raise ValueError("obstacle_critical_cm must be smaller than obstacle_warning_cm")
        return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILES, env_file_encoding="utf-8", extra="ignore")

    lightsync_mode: Literal["demo", "live"] = "demo"
    lightsync_device_id: str = "lightsync-gateway-01"
    lightsync_api_key: SecretStr | None = None
    lightsync_cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    lightsync_log_level: str = "INFO"

    blynk_server: str = "blynk.cloud"
    blynk_token: SecretStr | None = None
    blynk_poll_interval: float = Field(2.0, ge=0.5, le=60)
    blynk_timeout: float = Field(5.0, ge=1, le=30)
    blynk_connected_check_interval: float = Field(10.0, ge=2, le=300)

    telemetry_freshness_seconds: float = Field(15.0, ge=2, le=3600)
    history_max_samples: int = Field(3600, ge=60, le=86400)
    events_max: int = Field(500, ge=10, le=10000)

    commands_enabled: bool = False
    command_ack_timeout: float = Field(8.0, ge=1, le=60)

    @field_validator("blynk_server")
    @classmethod
    def _bare_host(cls, v: str) -> str:
        v = v.strip().removeprefix("https://").removeprefix("http://").rstrip("/")
        if not v or "/" in v or "?" in v or " " in v:
            raise ValueError("BLYNK_SERVER must be a bare host name such as blynk.cloud or fra1.blynk.cloud")
        return v

    @field_validator("lightsync_api_key", "blynk_token", mode="before")
    @classmethod
    def _empty_is_none(cls, v):  # noqa: ANN001
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.lightsync_cors_origins.split(",") if o.strip()]

    @property
    def blynk_configured(self) -> bool:
        return self.blynk_token is not None


def env_source() -> dict[str, str]:
    """Merged view of the .env files and the process environment (env wins)."""
    merged: dict[str, str] = {}
    for path in ENV_FILES:
        if path.is_file():
            merged.update({k: v for k, v in dotenv_values(path).items() if v is not None})
    merged.update(os.environ)
    return merged


@lru_cache
def get_settings() -> Settings:
    return Settings()


def load_pin_map() -> dict[str, str | None]:
    return resolve_pin_map(env_source())

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import Settings, get_settings, load_pin_map
from .datastreams import FIELD_BY_KEY, PinConfigError, resolve_pin_map
from .telemetry import TelemetryService


class _JsonishFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = f'level={record.levelname} logger={record.name} msg="{record.getMessage()}"'
        if record.exc_info:
            base += f" exc={self.formatException(record.exc_info)!r}"
        return base


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonishFormatter())
    root = logging.getLogger("lightsync")
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    root.propagate = False
    # httpx logs full request URLs at INFO, which would include the Blynk token.
    logging.getLogger("httpx").setLevel(logging.WARNING)


def build_service(settings: Settings, **kwargs) -> TelemetryService:
    errors: list[str] = []
    try:
        pin_map = load_pin_map()
    except PinConfigError as exc:
        errors.append(f"Pin mapping error: {exc}. Falling back to default pins.")
        pin_map = resolve_pin_map({})
    if settings.lightsync_mode == "live" and not settings.blynk_configured:
        errors.append("LIGHTSYNC_MODE=live but BLYNK_TOKEN is empty; telemetry will be offline.")
    unmapped = [k for k, p in pin_map.items() if p is None and k in FIELD_BY_KEY]
    logging.getLogger("lightsync").info("Unmapped telemetry fields: %s", ", ".join(unmapped) or "none")
    return TelemetryService(settings, pin_map, config_errors=errors, **kwargs)


def create_app(settings: Settings | None = None, service: TelemetryService | None = None,
               *, start_loop: bool = True) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.lightsync_log_level)
    telemetry = service or build_service(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_loop:
            await telemetry.start()
        try:
            yield
        finally:
            await telemetry.stop()

    app = FastAPI(title="LightSync Safety Console API", version=__version__, lifespan=lifespan)
    app.state.telemetry = telemetry
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "X-API-Key"],
    )

    from .routes import router

    app.include_router(router)
    return app


app = create_app()

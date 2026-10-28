"""Operator and device authentication, plus rate limiting.

State-changing requests (commands, mode switches, threshold edits) must carry
``X-API-Key`` matching ``LIGHTSYNC_API_KEY``. If no key is configured, those
requests are only allowed while the server is in demo mode, where they affect
the simulator alone. In live mode a key is mandatory.

The car authenticates its telemetry posts with ``X-Device-Key`` matching
``LIGHTSYNC_DEVICE_KEY``, a separate secret from the operator key.
"""

from __future__ import annotations

import hmac
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status

from .config import Settings


class RateLimiter:
    """Sliding-window limiter keyed by client address and bucket name."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                retry = max(1, int(self.window - (now - hits[0])))
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                    detail="Too many requests; slow down",
                                    headers={"Retry-After": str(retry)})
            hits.append(now)


command_limiter = RateLimiter(limit=10, window_seconds=60)
config_limiter = RateLimiter(limit=30, window_seconds=60)
# The car posts about once a second; this leaves room for retries.
device_limiter = RateLimiter(limit=300, window_seconds=60)


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def verify_operator(request: Request, settings: Settings, mode: str) -> None:
    configured = settings.lightsync_api_key
    provided = request.headers.get("x-api-key")
    if configured is None:
        if mode == "demo":
            return
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail="LIGHTSYNC_API_KEY must be configured on the server before "
                                   "operator actions are allowed in live mode")
    if not provided or not hmac.compare_digest(provided.encode(), configured.get_secret_value().encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid operator key",
                            headers={"WWW-Authenticate": "ApiKey"})


def verify_device(request: Request, settings: Settings) -> None:
    configured = settings.lightsync_device_key
    if configured is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail="LIGHTSYNC_DEVICE_KEY must be configured on the server before "
                                   "the car can post telemetry")
    provided = request.headers.get("x-device-key")
    if not provided or not hmac.compare_digest(provided.encode(), configured.get_secret_value().encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid device key",
                            headers={"WWW-Authenticate": "ApiKey"})


def device_guard():
    def dependency(request: Request) -> None:
        device_limiter.check(f"device:{_client_key(request)}")
        verify_device(request, request.app.state.telemetry.settings)

    return Depends(dependency)


def operator_guard(limiter: RateLimiter):
    def dependency(request: Request) -> None:
        limiter.check(f"{limiter.limit}:{_client_key(request)}")
        service = request.app.state.telemetry
        verify_operator(request, service.settings, service.mode)

    return Depends(dependency)

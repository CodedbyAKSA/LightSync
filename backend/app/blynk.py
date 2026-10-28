"""Minimal client for the documented Blynk device HTTPS API.

Endpoints used (https://docs.blynk.io/en/blynk.cloud/device-https-api):

* ``GET /external/api/getAll?token=...``              all stored datastream values
* ``GET /external/api/isHardwareConnected?token=...`` ``true`` / ``false``
* ``GET /external/api/update?token=...&v19=1``        write one virtual pin

The device token is sent only to the configured Blynk server and is scrubbed
from every exception message and log line this module produces.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

log = logging.getLogger("lightsync.blynk")


class BlynkError(RuntimeError):
    """A sanitized Blynk failure. ``retry_after`` is set for rate limiting."""

    def __init__(self, message: str, *, status: int | None = None, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class BlynkClient:
    def __init__(self, server: str, token: str, *, timeout: float = 5.0,
                 transport: httpx.AsyncBaseTransport | None = None):
        if not token:
            raise ValueError("Blynk token is required")
        self._token = token
        self.server = server
        self._client = httpx.AsyncClient(
            base_url=f"https://{server}/external/api",
            timeout=httpx.Timeout(timeout),
            transport=transport,
            headers={"User-Agent": "LightSync-Safety-Console/1.0"},
        )

    def redact(self, text: str) -> str:
        return text.replace(self._token, "***") if self._token else text

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict[str, Any]) -> httpx.Response:
        try:
            response = await self._client.get(path, params={"token": self._token, **params})
        except httpx.TimeoutException as exc:
            raise BlynkError(f"Timed out contacting {self.server}") from exc
        except httpx.HTTPError as exc:
            raise BlynkError(self.redact(f"Network error contacting {self.server}: "
                                         f"{type(exc).__name__}")) from exc

        if response.status_code == 429:
            retry = response.headers.get("Retry-After")
            raise BlynkError("Blynk rate limit reached", status=429,
                             retry_after=float(retry) if retry and retry.isdigit() else 30.0)
        if response.status_code >= 400:
            raise BlynkError(self.redact(f"Blynk {path} returned HTTP {response.status_code}: "
                                         f"{_error_message(response)}"), status=response.status_code)
        return response

    async def get_all(self) -> dict[str, Any]:
        response = await self._get("/getAll", {})
        try:
            data = response.json()
        except (json.JSONDecodeError, ValueError) as exc:
            raise BlynkError("Blynk getAll returned a non-JSON body") from exc
        if not isinstance(data, dict):
            raise BlynkError("Blynk getAll returned an unexpected payload")
        return data

    async def is_hardware_connected(self) -> bool:
        response = await self._get("/isHardwareConnected", {})
        body = response.text.strip().lower()
        if body not in {"true", "false"}:
            raise BlynkError("Blynk isHardwareConnected returned an unexpected body")
        return body == "true"

    async def update(self, pin: str, value: int | float | str) -> None:
        if not pin.lower().startswith("v"):
            raise ValueError("Only virtual pins may be written")
        await self._get("/update", {pin.lower(): value})


def _error_message(response: httpx.Response) -> str:
    try:
        data = response.json()
        message = data.get("error", {}).get("message")
        if isinstance(message, str):
            return message[:200]
    except (json.JSONDecodeError, ValueError, AttributeError):
        pass
    return response.reason_phrase or "error"

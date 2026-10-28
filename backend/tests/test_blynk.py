import asyncio

import httpx
import pytest

from app.blynk import BlynkClient, BlynkError
from tests.conftest import TOKEN, FakeBlynk


def client(fake: FakeBlynk) -> BlynkClient:
    return BlynkClient("blynk.cloud", TOKEN, transport=fake.transport)


def test_get_all_uses_documented_endpoint():
    fake = FakeBlynk({"v0": 12.4})
    data = asyncio.run(client(fake).get_all())
    assert data == {"v0": 12.4}
    req = fake.requests[0]
    assert req.url.host == "blynk.cloud"
    assert req.url.path == "/external/api/getAll"
    assert req.url.params["token"] == TOKEN


def test_is_hardware_connected():
    assert asyncio.run(client(FakeBlynk(connected=False)).is_hardware_connected()) is False
    assert asyncio.run(client(FakeBlynk(connected=True)).is_hardware_connected()) is True


def test_update_writes_virtual_pin():
    fake = FakeBlynk()
    asyncio.run(client(fake).update("V19", 1))
    assert fake.requests[0].url.path == "/external/api/update"
    assert fake.requests[0].url.params["v19"] == "1"
    with pytest.raises(ValueError):
        asyncio.run(client(fake).update("D4", 1))


def test_errors_never_contain_token():
    fake = FakeBlynk()
    fake.fail_status = 400
    with pytest.raises(BlynkError) as info:
        asyncio.run(client(fake).get_all())
    assert TOKEN not in str(info.value)
    assert "HTTP 400" in str(info.value)


def test_rate_limit_sets_retry_after():
    fake = FakeBlynk()
    fake.fail_status = 429
    with pytest.raises(BlynkError) as info:
        asyncio.run(client(fake).get_all())
    assert info.value.status == 429 and info.value.retry_after == 30.0


def test_network_error_is_sanitized():
    def boom(request):
        raise httpx.ConnectError(f"cannot connect {request.url}")

    c = BlynkClient("blynk.cloud", TOKEN, transport=httpx.MockTransport(boom))
    with pytest.raises(BlynkError) as info:
        asyncio.run(c.get_all())
    assert TOKEN not in str(info.value)


def test_non_json_payload_rejected():
    c = BlynkClient("blynk.cloud", TOKEN,
                    transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>")))
    with pytest.raises(BlynkError):
        asyncio.run(c.get_all())

import hashlib
import io
import zipfile
from pathlib import Path

import pytest

from chess_ml.download import (
    DEFAULT_MONTH,
    InvalidArchiveError,
    download_month,
    month_url,
    validate_zip_bytes,
)


def make_zip(payload: bytes = b"pgn") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("lichess_elite.pgn", payload)
    return buffer.getvalue()


def test_default_month_and_url() -> None:
    assert DEFAULT_MONTH == "2025-11"
    assert month_url("2025-11") == (
        "https://database.nikonoel.fr/lichess_elite_2025-11.zip"
    )
    with pytest.raises(ValueError):
        month_url("2025-13")
    with pytest.raises(ValueError):
        month_url("../etc/passwd")


def test_validate_zip_bytes_accepts_a_real_zip() -> None:
    validate_zip_bytes(make_zip())


def test_validate_zip_bytes_rejects_html_with_a_clear_message() -> None:
    html = b"<!DOCTYPE html><html><body>Not found</body></html>"
    with pytest.raises(InvalidArchiveError, match="not a ZIP"):
        validate_zip_bytes(html)


def test_download_month_caches_and_records_sha(tmp_path: Path) -> None:
    archive = make_zip(b"hello")
    source = tmp_path / "source.zip"
    source.write_bytes(archive)

    result = download_month(
        "2025-11",
        raw_dir=tmp_path / "raw",
        url=source.as_uri(),
    )
    assert result.path.read_bytes() == archive
    assert result.sha256 == hashlib.sha256(archive).hexdigest()
    assert result.cached is False
    assert Path(f"{result.path}.sha256").read_text().strip() == result.sha256

    again = download_month(
        "2025-11", raw_dir=tmp_path / "raw", url=source.as_uri()
    )
    assert again.cached is True
    assert again.sha256 == result.sha256


def test_corrupt_cache_is_replaced(tmp_path: Path) -> None:
    archive = make_zip(b"good")
    source = tmp_path / "source.zip"
    source.write_bytes(archive)
    raw = tmp_path / "raw"
    raw.mkdir()
    cached = raw / "lichess_elite_2025-11.zip"
    cached.write_bytes(b"corrupt")
    Path(f"{cached}.sha256").write_text("0" * 64)

    result = download_month("2025-11", raw_dir=raw, url=source.as_uri())
    assert result.cached is False
    assert cached.read_bytes() == archive


def test_download_rejects_html(tmp_path: Path) -> None:
    source = tmp_path / "looks-like-a-zip.zip"
    source.write_text("<!DOCTYPE html><html>new month not available</html>")

    with pytest.raises(InvalidArchiveError, match="HTML"):
        download_month("2025-12", raw_dir=tmp_path / "raw", url=source.as_uri())
    assert not (tmp_path / "raw" / "lichess_elite_2025-12.zip").exists()

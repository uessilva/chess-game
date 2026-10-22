"""Lichess Elite Database downloader with magic-byte validation."""

from __future__ import annotations

import re
import shutil
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from chess_ml.storage import sha256_file

DEFAULT_MONTH = "2025-11"
BASE_URL = "https://database.nikonoel.fr"
USER_AGENT = "chess-ml/0.1 (+https://github.com/uessilva/chess-game)"

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class InvalidArchiveError(ValueError):
    """The response was not a ZIP archive (usually the site's HTML page)."""


@dataclass(frozen=True)
class DownloadResult:
    month: str
    url: str
    path: Path
    sha256: str
    bytes: int
    cached: bool


def month_url(month: str) -> str:
    if not _MONTH.fullmatch(month):
        raise ValueError(f"invalid month {month!r}; expected YYYY-MM")
    return f"{BASE_URL}/lichess_elite_{month}.zip"


def validate_zip_bytes(data: bytes) -> None:
    """Reject HTML masquerading as a 200 response; accept a real archive."""
    if data.startswith(b"PK\x03\x04") or data.startswith(b"PK\x05\x06"):
        return
    prefix = data[:200].lstrip().lower()
    if prefix.startswith((b"<!doctype", b"<html", b"<?xml")):
        raise InvalidArchiveError(
            "response is HTML, not a ZIP archive "
            "(the requested month probably does not exist)"
        )
    raise InvalidArchiveError(
        "response is not a ZIP archive (missing PK magic bytes)"
    )


def _result(
    month: str,
    url: str,
    path: Path,
    sha256: str,
    *,
    cached: bool,
) -> DownloadResult:
    return DownloadResult(
        month=month,
        url=url,
        path=path,
        sha256=sha256,
        bytes=path.stat().st_size,
        cached=cached,
    )


def _read_sha_sidecar(path: Path) -> str | None:
    sidecar = Path(f"{path}.sha256")
    if not sidecar.exists():
        return None
    return sidecar.read_text().strip() or None


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with (
        urllib.request.urlopen(request) as response,
        destination.open("wb") as handle,
    ):
        shutil.copyfileobj(response, handle)


def download_month(
    month: str, *, raw_dir: Path, url: str | None = None
) -> DownloadResult:
    """Download (or reuse) the month's ZIP, validating its contents.

    A cached archive is trusted only when its sidecar hash still matches.
    A cached file without a sidecar is validated and hashed; anything
    corrupt is replaced by a fresh download.
    """
    resolved_url = url or month_url(month)
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / f"lichess_elite_{month}.zip"

    if path.exists():
        expected = _read_sha_sidecar(path)
        actual = sha256_file(path)
        if expected == actual:
            return _result(month, resolved_url, path, actual, cached=True)
        if expected is None:
            try:
                validate_zip_bytes(path.read_bytes()[:512])
            except InvalidArchiveError:
                pass
            else:
                Path(f"{path}.sha256").write_text(actual + "\n")
                return _result(month, resolved_url, path, actual, cached=True)
        path.unlink()

    temporary = path.with_suffix(".zip.part")
    try:
        _download(resolved_url, temporary)
        validate_zip_bytes(temporary.read_bytes()[:512])
        if not zipfile.is_zipfile(temporary):
            raise InvalidArchiveError(
                "response has ZIP magic bytes but is not a valid archive"
            )
        digest = sha256_file(temporary)
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    Path(f"{path}.sha256").write_text(digest + "\n")
    return _result(month, resolved_url, path, digest, cached=False)

import io
import json
import re
from functools import lru_cache
from typing import Dict, Optional, Tuple

import requests
from pypdf import PdfReader

MAX_FILE_SIZE = 20 * 1024 * 1024
DOI_PATTERN = re.compile(r"10\.\d{4,9}/\S+", re.IGNORECASE)
TRAILING_PUNCTUATION = ".,;:)]}\"'"
REQUEST_TIMEOUT = 15
USER_AGENT = "PDF-DOI-Renamer/1.0 (mailto:replace-with-your-email@example.com)"


def _cors_headers() -> Dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Expose-Headers": "Content-Disposition",
    }


def _set_headers(response, extra: Optional[Dict[str, str]] = None) -> None:
    headers = _cors_headers()
    if extra:
        headers.update(extra)
    for key, value in headers.items():
        response.setHeader(key, value)


def _read_request_body(request) -> bytes:
    body = getattr(request, "body", b"")
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8", errors="ignore")
    if hasattr(body, "read"):
        data = body.read()
        return data if isinstance(data, bytes) else bytes(data)
    return b""


def _parse_multipart(content_type: str, body: bytes) -> Tuple[Dict[str, str], Dict[str, Dict[str, bytes]]]:
    boundary_match = re.search(r"boundary=([^;]+)", content_type, flags=re.IGNORECASE)
    if not boundary_match:
        raise ValueError("Missing multipart boundary")

    boundary = boundary_match.group(1).strip().strip('"').encode("utf-8", errors="ignore")
    delimiter = b"--" + boundary
    fields: Dict[str, str] = {}
    files: Dict[str, Dict[str, bytes]] = {}

    for raw_part in body.split(delimiter):
        part = raw_part.strip()
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].rstrip()

        header_blob, sep, content = part.partition(b"\r\n\r\n")
        if not sep:
            continue

        headers: Dict[str, str] = {}
        for line in header_blob.split(b"\r\n"):
            if b":" not in line:
                continue
            key, value = line.split(b":", 1)
            headers[key.decode("utf-8", errors="ignore").strip().lower()] = value.decode(
                "utf-8", errors="ignore"
            ).strip()

        if content.endswith(b"\r\n"):
            content = content[:-2]

        disposition = headers.get("content-disposition", "")
        name_match = re.search(r'name="([^\"]+)"', disposition)
        if not name_match:
            continue
        field_name = name_match.group(1)

        filename_match = re.search(r'filename="([^\"]*)"', disposition)
        if filename_match:
            files[field_name] = {
                "filename": filename_match.group(1).encode("utf-8", errors="ignore"),
                "content": content,
                "content_type": headers.get("content-type", "").encode("utf-8", errors="ignore"),
            }
        else:
            fields[field_name] = content.decode("utf-8", errors="ignore")

    return fields, files


def _normalize_doi(raw_doi: str) -> str:
    cleaned = raw_doi.strip().lower().rstrip(TRAILING_PUNCTUATION)
    return cleaned


def _extract_doi(pdf_data: bytes) -> Optional[str]:
    try:
        reader = PdfReader(io.BytesIO(pdf_data))
    except Exception:
        return None

    page_count = min(2, len(reader.pages))
    collected_text = []
    for idx in range(page_count):
        try:
            collected_text.append(reader.pages[idx].extract_text() or "")
        except Exception:
            continue

    text = "\n".join(collected_text)
    match = DOI_PATTERN.search(text)
    if not match:
        return None
    return _normalize_doi(match.group(0))


def _safe_text(value: Optional[str], fallback: str) -> str:
    if not value:
        value = fallback
    sanitized = re.sub(r"[\r\n]+", " ", value).strip()
    sanitized = re.sub(r"\s+", " ", sanitized)
    return sanitized


def _slugify(value: str) -> str:
    value = value.lower()
    value = value.replace("/", "-")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "unknown"


def _http_get_with_retry(url: str, headers: Dict[str, str]) -> Optional[requests.Response]:
    delay_seconds = 0.6
    for attempt in range(3):
        try:
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            if response.status_code >= 500 and attempt < 2:
                import time

                time.sleep(delay_seconds)
                delay_seconds *= 2
                continue
            return response
        except requests.RequestException:
            if attempt < 2:
                import time

                time.sleep(delay_seconds)
                delay_seconds *= 2
                continue
            return None
    return None


@lru_cache(maxsize=256)
def _fetch_metadata(doi: str) -> Dict[str, str]:
    default = {
        "journal": "unknown-journal",
        "year": "unknown-year",
        "author": "unknown-author",
        "title": "unknown-title",
        "doi": doi,
    }

    crossref_url = f"https://api.crossref.org/works/{doi}"
    crossref_headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    response = _http_get_with_retry(crossref_url, crossref_headers)
    if response is not None and response.ok:
        try:
            message = response.json().get("message", {})
            journal = _safe_text((message.get("container-title") or [""])[0], default["journal"])
            year_parts = (message.get("issued", {}).get("date-parts") or [[""]])[0]
            year = str(year_parts[0]) if year_parts and year_parts[0] else default["year"]
            author = ""
            if message.get("author"):
                author = message["author"][0].get("family") or message["author"][0].get("name") or ""
            title = _safe_text((message.get("title") or [""])[0], default["title"])
            return {
                "journal": journal,
                "year": _safe_text(year, default["year"]),
                "author": _safe_text(author, default["author"]),
                "title": title,
                "doi": doi,
            }
        except Exception:
            pass

    openalex_url = f"https://api.openalex.org/works/https://doi.org/{doi}"
    response = _http_get_with_retry(openalex_url, {"Accept": "application/json", "User-Agent": USER_AGENT})
    if response is not None and response.ok:
        try:
            data = response.json()
            journal = _safe_text(
                ((data.get("primary_location") or {}).get("source") or {}).get("display_name"),
                default["journal"],
            )
            year = _safe_text(str(data.get("publication_year") or ""), default["year"])
            authorships = data.get("authorships") or []
            author = ""
            if authorships:
                author = ((authorships[0].get("author") or {}).get("display_name")) or ""
            title = _safe_text(data.get("title"), default["title"])
            return {
                "journal": journal,
                "year": year,
                "author": _safe_text(author, default["author"]),
                "title": title,
                "doi": doi,
            }
        except Exception:
            pass

    return default


def _build_filename(metadata: Dict[str, str]) -> str:
    parts = [
        _slugify(_safe_text(metadata.get("journal"), "unknown-journal")),
        _slugify(_safe_text(metadata.get("year"), "unknown-year")),
        _slugify(_safe_text(metadata.get("author"), "unknown-author")),
        _slugify(_safe_text(metadata.get("title"), "unknown-title")),
        _slugify(_safe_text(metadata.get("doi"), "unknown-doi")),
    ]
    base = "_".join(parts)
    base = re.sub(r"[\r\n\"]+", "", base)
    max_base_len = 216
    if len(base) > max_base_len:
        base = base[:max_base_len].rstrip("-_")
    return f"{base}.pdf"


def _error(response, status_code: int, message: str):
    _set_headers(response, {"Content-Type": "application/json"})
    return response.status(status_code).send(json.dumps({"error": message}))


def handler(request, response):
    method = getattr(request, "method", "GET").upper()

    if method == "OPTIONS":
        _set_headers(response)
        return response.status(204).send("")

    if method != "POST":
        return _error(response, 405, "Method not allowed")

    content_type = (getattr(request, "headers", {}) or {}).get("content-type", "")
    if "multipart/form-data" not in content_type.lower():
        return _error(response, 400, "Expected multipart/form-data request")

    body = _read_request_body(request)
    if not body:
        return _error(response, 400, "Request body is empty")
    if len(body) > MAX_FILE_SIZE + 1024 * 128:
        return _error(response, 413, "Payload too large. PDF limit is 20MB")

    try:
        _, files = _parse_multipart(content_type, body)
    except ValueError as exc:
        return _error(response, 400, str(exc))
    except Exception:
        return _error(response, 400, "Malformed multipart form data")

    file_info = files.get("file")
    if not file_info:
        return _error(response, 400, "No file field found. Use field name 'file'")

    pdf_bytes = file_info.get("content") or b""
    mime_type = (file_info.get("content_type") or b"").decode("utf-8", errors="ignore").lower()

    if mime_type != "application/pdf":
        return _error(response, 415, "Unsupported file type. Please upload a PDF")

    if len(pdf_bytes) > MAX_FILE_SIZE:
        return _error(response, 413, "Payload too large. PDF limit is 20MB")

    if not pdf_bytes.startswith(b"%PDF-"):
        return _error(response, 400, "Malformed or invalid PDF file")

    doi = _extract_doi(pdf_bytes)
    if not doi:
        return _error(response, 404, "DOI not found in first two pages")

    metadata = _fetch_metadata(doi)
    filename = _build_filename(metadata)

    _set_headers(
        response,
        {
            "Content-Type": "application/pdf",
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "public, max-age=3600",
        },
    )
    return response.status(200).send(pdf_bytes)

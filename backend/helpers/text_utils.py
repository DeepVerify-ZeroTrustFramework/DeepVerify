"""Text helpers: safe truncation, masking and file-name slugs."""
import re
import unicodedata


def truncate(text: str, max_len: int = 80, suffix: str = "…") -> str:
    """Shorten ``text`` to at most ``max_len`` characters, ending with ``suffix`` when cut."""
    if max_len <= len(suffix):
        raise ValueError("max_len must be longer than the suffix")
    return text if len(text) <= max_len else text[: max_len - len(suffix)].rstrip() + suffix


def mask_email(email: str) -> str:
    """``alice@example.com`` -> ``a***e@example.com`` (for logs and reports)."""
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    if len(local) <= 2:
        return local[:1] + "***@" + domain
    return f"{local[0]}***{local[-1]}@{domain}"


def slugify(text: str) -> str:
    """Lower-case, ASCII-only, hyphen-separated slug (safe for file names such as report PDFs)."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "item"

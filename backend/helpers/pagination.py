"""Pagination helpers for list endpoints (page/limit -> skip/limit, and a response envelope)."""
from math import ceil
from typing import Any, Dict, List

MAX_LIMIT = 100


def clamp_page(page: int, limit: int, default_limit: int = 20) -> tuple[int, int]:
    """Return a safe ``(page, limit)`` pair: page >= 1, 1 <= limit <= MAX_LIMIT."""
    page = max(1, int(page or 1))
    limit = int(limit or default_limit)
    return page, min(max(1, limit), MAX_LIMIT)


def to_skip_limit(page: int, limit: int) -> tuple[int, int]:
    """Convert page/limit to the ``skip``/``limit`` pair MongoDB expects."""
    page, limit = clamp_page(page, limit)
    return (page - 1) * limit, limit


def paginate_response(items: List[Any], total: int, page: int, limit: int) -> Dict[str, Any]:
    page, limit = clamp_page(page, limit)
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": ceil(total / limit) if total else 0,
        "has_next": page * limit < total,
    }

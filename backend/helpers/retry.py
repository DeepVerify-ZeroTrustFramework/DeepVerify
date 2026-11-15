"""A small retry-with-backoff helper for flaky calls (network, third-party APIs)."""
import time
from typing import Callable, Tuple, Type, TypeVar

T = TypeVar("T")


def retry(
    fn: Callable[[], T],
    attempts: int = 3,
    base_delay: float = 0.5,
    exceptions: Tuple[Type[BaseException], ...] = (Exception,),
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Call ``fn`` up to ``attempts`` times, doubling the delay after each failure."""
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    for attempt in range(attempts):
        try:
            return fn()
        except exceptions:
            if attempt == attempts - 1:
                raise
            sleep(base_delay * (2 ** attempt))
    raise RuntimeError("unreachable")

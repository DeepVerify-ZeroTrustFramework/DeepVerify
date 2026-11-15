# Helper modules

Small, dependency-free helpers. **Nothing in the existing code imports them**, so they change no behaviour.

## Backend — `backend/helpers/`
| File | Offers |
|---|---|
| `pagination.py` | `clamp_page`, `to_skip_limit`, `paginate_response` |
| `text_utils.py` | `truncate`, `mask_email`, `slugify` |
| `retry.py` | `retry(fn, attempts, base_delay)` with exponential backoff |

## Frontend — `frontend/src/helpers/`
| File | Offers |
|---|---|
| `classNames.ts` | `classNames(...)` to join CSS classes |
| `math.ts` | `clamp`, `average`, `median` |
| `timeAgo.ts` | `timeAgo(date)` → "5 minutes ago" |
| `index.ts` | Re-exports the frontend helpers |

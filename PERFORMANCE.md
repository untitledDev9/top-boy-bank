# Backend performance notes

What was changed, how to tune or roll it back, and how to verify it.

## What changed (short version)

| Area | Change |
|---|---|
| Money movement | `transfer`, `withdraw` and admin credit/debit now change balances with **atomic** `findOneAndUpdate` (`$inc` + a `balance >= amount` guard) instead of read → modify → `save()`. Fixes lost updates / double-spending when requests overlap. Partial failures are rolled back (`utils/ledger.ts`). |
| Round trips | Independent reads run in parallel; `/auth/me` went from 4 sequential DB calls to 1 parallel batch; transfer from ~11 sequential calls to ~5. |
| Auth lookup | `protect` caches the user record for a few seconds (single-flight, invalidated on deactivate / verify / delete / profile update). |
| Settings | Maintenance flag/message read from a short-lived cache, cleared the moment an admin changes it. |
| Email | One pooled SMTP transporter (was a new TCP+TLS+auth handshake per email); the transfer receipt no longer blocks the response. |
| Payloads | `compression` middleware (gzip) — chat poll 64 KB → 3 KB, transaction list 21 KB → 2 KB. |
| Chat | Customer poll uses `lean()`; AI call has a timeout, bounded history and an atomic "append only if still AI-handled" write. |
| Queries | Transaction count + page in parallel; `lean()` on read-only lists; analytics user counts are one aggregation; regexes from search boxes are escaped (ReDoS) and page sizes clamped. |
| Indexes | `chats {customer_id, status}`, `users {reset_token}` (sparse). |
| Hashing | Native `bcrypt` (optional dependency) with automatic fallback to `bcryptjs`; cost factor unchanged (12). |
| Process | `.env` is loaded before other modules; JSON body limit 100 KB (was 15 MB); keep-alive tuned for load balancers; graceful shutdown. |

## New environment variables (all optional)

| Variable | Default | Purpose / rollback |
|---|---|---|
| `AUTH_USER_CACHE_TTL_MS` | `5000` | User-record cache in `protect`. `0` disables it. |
| `SETTINGS_CACHE_TTL_MS` | `5000` | Maintenance-settings cache. `0` disables it. |
| `ACCOUNT_ID_CACHE_TTL_MS` | `60000` | user → account-id cache for list endpoints. `0` disables it. |
| `JSON_BODY_LIMIT` | `100kb` | Request body limit. Set `15mb` to restore the old behaviour. |
| `TRUST_PROXY` | unset | Set to the number of proxy hops (e.g. `1`) when deployed behind a load balancer so per-IP rate limiting sees real client IPs. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `10000` | Fail fast when the database is unreachable. |
| `MONGO_SOCKET_TIMEOUT_MS` | `45000` | Abort operations on a silent socket. |
| `MONGO_MAX_POOL_SIZE` | driver default (100) | Lower it if your Atlas tier limits connections. |
| `MONGO_AUTO_INDEX` | `true` | Set `false` to stop the app creating indexes at startup (then create the two new ones yourself). |
| `GROQ_TIMEOUT_MS` | `20000` | AI request timeout before the canned reply is used. |
| `AI_HISTORY_MESSAGES` | `20` | How many recent messages are sent to the model. |
| `GROQ_URL` | provider URL | Override the AI endpoint (used by tests). |

New dependencies: `compression` (+ `@types/compression`), and `bcrypt` as an **optional** dependency.

## Operational notes

* **Caches are per process.** With several app instances, an invalidation (e.g. deactivating a user) takes effect immediately on the instance that handled it and within the TTL (5 s) on the others. Set the `*_TTL_MS` values to `0` if you need strict cross-instance consistency.
* **Indexes are built on first start** (`MONGO_AUTO_INDEX`). Both new indexes are on small collections and build in the background.
* **Not covered:** money movement is atomic per balance change and compensated on failure, but it is not a multi-document MongoDB transaction — a process crash *between* the debit and the credit can still leave a balance to reconcile. If you want that closed too, wrap the transfer in a transaction (needs a replica set, which Atlas provides).

## Tests

```bash
# Needs a LOCAL / disposable MongoDB. The suite refuses hosted (Atlas) URIs.
TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test

# Same suite against the bcryptjs fallback:
TEST_NO_NATIVE_BCRYPT=1 TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
```

Each run starts the real server against a throwaway database (dropped afterwards), stubs SMTP and the AI provider, and never touches your configured `MONGO_URI`.

# Design — Usage Metering & Billing Engine

*Phase 1 design document · FlyRank Backend Capstone*

---

## 1. The problem

A multi-tenant SaaS needs one trustworthy answer to three questions per customer:

1. How much have they used this month?
2. How much do they owe?
3. Have they hit their plan limit?

Getting these wrong have cost. Counting a retried request twice overcharges the customer. Letting a request through past quota gives away revenue. Getting the math off by a fraction of a cent compounds across thousands of tenants. This project builds a small backend service that answers those three questions correctly including the edge cases that are easy to get wrong like retries, quota boundaries, mixed token pricing.

## 2. Plans and quotas

Two plans to start.

| Plan | API calls / month | AI tokens / month | Price |
|---|---|---|---|
| `free` | 1,000 | 100,000 | $0 |
| `pro` | 50,000 | 5,000,000 | $29.00 |

**Notes:**
- The Free tier is fixed by the brief.
- The Pro numbers are my choice, I picked 50× Free on both dimensions so the multiplier is easy to explain. **These might change** if I find a better ratio while testing.
- Billing period: a calendar month in UTC. Resets at `00:00 UTC` on the 1st of next month.
- **One `/generate` request counts as 1 API call AND N tokens.** Both quotas are checked; whichever would be exceeded first blocks the request.

## 3 Database Model/Schema (Planned)
There are 4 main Database tables for now
Column names may shift slightly in Phase 2

### `plans`
The two subscription tiers and their limits.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `'free'` or `'pro'` |
| `name` | text | Display name |
| `api_call_limit` | int | 1000 (free) / 50000 (pro) |
| `ai_token_limit` | bigint | 100000 (free) / 5000000 (pro) |
| `price_cents` | int | 0 / 2900 — money is always integer |

### `tenants`
One row per customer.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `api_key_hash` | text UNIQUE | SHA-256 of the key, never the raw key |
| `plan_id` | FK → plans.id | Current plan |
| `status` | text | `'active'` or `'past_due'` |
| `stripe_customer_id` | text UNIQUE NULL | Null until they first pay |
| `created_at` | timestamptz | |

### `subscriptions`
Mirrors Stripe's view of what the tenant is paying for.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | FK → tenants.id | The FK lives on this side, because a tenant can have many subscriptions over time |
| `stripe_subscription_id` | text UNIQUE | How we match incoming webhooks to this row |
| `plan_id` | FK → plans.id | |
| `status` | text | Stripe's status: `'active'`, `'past_due'`, `'canceled'` |
| `current_period_end` | timestamptz | Used to compute the 429's Retry-After |
| `last_event_at` | timestamptz | To ignore out-of-order webhooks |

### `usage_events`
One row per billable action. The big table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | FK → tenants.id | |
| `period` | char(7) | e.g. `'2026-09'` — so monthly rollups are a fast string match |
| `idempotency_key` | text | Client-supplied; the heart of the project |
| `request_hash` | text | Detects key reuse with a different body |
| `api_calls` | int | Usually 1 |
| `input_tokens` | bigint | |
| `cached_input_tokens` | bigint | A subset of input_tokens (cheaper) |
| `output_tokens` | bigint | |
| `reasoning_tokens` | bigint | Billed as output |
| `cost_nanos` | bigint | Integer nano-dollars — never a float |
| `response_body` | jsonb | Stored so a replay returns the exact same response |
| `created_at` | timestamptz | |

Constraints (planned):
- `UNIQUE (tenant_id, idempotency_key)` — DB-level guard against double-counting
- `INDEX (tenant_id, period)` — fast monthly rollups

### FKs at a glance
tenants.plan_id → plans.id
subscriptions.tenant_id → tenants.id
subscriptions.plan_id → plans.id
usage_events.tenant_id → tenants.id

## 4. API surface (planned)

| Method & path | Auth | What it does |
|---|---|---|
| `POST /generate` | API key + `Idempotency-Key` header | The billable action. Body contains the token counts to meter. |
| `GET /usage` | API key | Returns used / limit / remaining for both quotas, plus the cost so far this period. |
| `GET /health` | none | Liveness check. |

## 5. Idempotency strategy (the core of the project)

This is the part the brief calls "the heart of the capstone." The plan:

Every `/generate` request must carry an `Idempotency-Key` header. The whole request runs inside one transaction:

1. **Lock the tenant row** (`SELECT ... FOR UPDATE`). This serializes requests for the same tenant, so two requests at 999/1000 cant both pass.
2. **Look up the key.** If it exists with the same body hash, return the stored response and do nothing else. If it exists with a different body, return `409 Conflict`.
3. **Check quotas.** If either quota would be exceeded, reject with 402 or 429. Nothing is stored.
4. **Insert the usage event and commit.**

The `UNIQUE (tenant_id, idempotency_key)` constraint is the last line of defense even if the application logic has a bug, the database won't allow a second row with the same key.

**One decision I made:** a key is only "used" if the request succeeds. If a Free tenant gets a 402 and then upgrades and retries with the same key, the retry should work. Invalid input 400 also shouldn't consume the key.

## 6. Quota boundary rule

A rule for "what happens at exactly the limit" and document it. choosing this one:

> A request is allowed if `used + requested <= limit` for both quotas. Otherwise it's rejected whole — no partial fulfilment, no event stored.

With a limit of 1,000 calls: the request that takes usage from 999 to 1,000 **succeeds**. The next one is rejected.

**Status codes:**

| Situation | Code | Reason |
|---|---|---|
| Free tenant over quota | **402 Payment Required** | Upgrading to Pro fixes it |
| Pro tenant over quota | **429 Too Many Requests** + `Retry-After` | Already on the top plan; the fix is to wait |
| Tenant `past_due` | **402 Payment Required** | Payment must be fixed first |

**Check order:** subscription state → API call quota → token quota. The first failure decides the response.

## 7 Non-goals

- **No overage billing.** Over-quota requests are rejected; we never charge past the plan.
- **No invoices, proration, or multi-currency.**
- **No real AI calls.** Token counts are simulated numbers passed in by the client.
- **No admin UI.** Endpoints only.
- **No per-second rate limiting.** `429` here means monthly quota, not request rate.
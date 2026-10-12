## BUILD LOG

A record of usage of AI 

## How I worked

I built this phase by phase, one file at a time. For most of the step wich i didnt knew or understood I described what the file needed to do, had the assistant explain me the topics to read and concepts to learn then try 
to code it with the help of AI and then test the behaviour myself. And even when I was not getting stuck and asking AI to give me the code i first ask it to explain the code and logic to me then add it in the program. Where I had no prior experience in Postgres row locking, Stripe webhook signatures, exact money arithmetic, i asked for the explanation first and then try to code with asking ai if it is correct and if getting stuck asking it to help me and give me code, so I understood the reason before the implementation. Also due to stipe availibility , i created mock fixtures so files inside folder `fixtures` and `scripts` were created by with AI help tho understanding it, as Stripe cli usually take cares of this. Also the curl commands to test were asked from AI

## Phase 1 — Design

**Where AI helped:**
- Explaining problem statement, API surface, idempotency flow and structre of the schema.
- Explained between storing money as cents, micro dollars or nano dollars.

## Phase 2 — Core billing logic

**Where AI helped:**
- The `meter.js` transaction shape with an explanation of why the lock is needed at all.
- The test cases in `test/billing.test.js`. AI was used to help create test cases to test against the 
  requirements.

**Where AI was wrong**
Response bodies were stored in a JSONB column.It reorders keys so it replayed
  response was not byte identical to the original. So
  Changed the column to JSON, which keeps the exact text.

**Changes Made**

- Used `FOR UPDATE OF t` instead of `FOR UPDATE`, so only the tenant row is locked and not
  the shared plan row, which every Free tenant would otherwise queue behind.

  ## Phase 3 — Stripe integration

- The verification and letting the worker apply it structure for `webhooks.js`, and the
  explanation of why the raw body is required for signature verification (`express.json()`
  reorders the bytes, so the signature can never match).
- The inbox + worker pattern with `FOR UPDATE SKIP LOCKED`, exponential backoff and the
  ALERT line after the final attempt.
- Static fixtures hardcoded `sub_test_demo1` and an old timestamp. After re seeding they
  the subscription no longer existed, so the worker retried them and then,
  once the id was right but the timestamp wasn't, ignored them as stale. I replaced them with
  `scripts/send-subscription-event.js`, which reads the live subscription and price id from
  the database
  
  ## Phase 4 — Cost, packaging and docs

- Helped in creating docker and docker-compose, espically in syntax 

**Where AI wrong** 
-The pricing draft at one point added `input_tokens + cached_input_tokens`, which charges the
  cached tokens twice. The correct formula subtracts first: `uncached = input − cached`, then
  prices the two parts at their own rates. I added a test that asserts the correct total
  differs from the naive one, so the bug cannot come back.
-  The first clean `docker compose up` failed: Postgres needed about 45 seconds to initialise
  on an empty volume and the health check allowed 40. Raised the start period and had the app
  wait for the database itself.

## Decisions I made

| Decision | Why |
|---|---|
| Free over quota → 402, Pro over quota → 429 + `Retry-After`, failed payment → 402 | A Free tenant can fix it by paying, a Pro tenant can only wait, so the codes should differ |
| Boundary rule: allowed iff `used + requested <= limit`, rejected whole | Simple to state, simple to test, no partial billing |
| Money in integer nano dollars | At that unit every per token price is a whole number, so no request is ever rounded |
| Dedupe check before the quota check | A retry of a request I already billed must not be punished because the quota is now full |
| Keep Stripe mock as the default even after real test mode worked | The evaluator has no keys; the probes must pass out of the box |
| Pro limits of 50,000 calls / 5,000,000 tokens and $29/month | 50x the Free plan, a round and believable number |

## Where the AI was wrong, and what I changed

| # | Problem | How it surfaced | Fix |
|---|---|---|---|
| 1 | Response bodies stored as `JSONB`, which reorders keys, so a replayed response was not byte identical. Probe 1 asks for a mirrored response | Comparing the two responses by eye | Changed the column to `JSON`, which keeps the exact text |
| 2 | `checkQuota` was given a parameter named `status`, clashing with the local `const status = isFree ? 402 : 429` | Node refused to load the file (`Identifier 'status' has already been declared`) | Renamed the parameter to `paymentStatus` |
| 3 | Errors logged as `err.message`, which is empty for Node's combined connection error. The seed and later the worker printed a failure with no reason | Spent time on a blank "Seed failed:" message | Log the whole error object; also added a filter so a database outage logs once instead of every second |
| 4 | First `docker compose up` on a clean volume failed: Postgres needed ~45s to initialise, the health check allowed 40s | Ran the clean machine path the way the evaluator would | Raised the health-check budget and had the app wait for the database itself |
| 5 | Migrations I had applied by hand were not recorded in `schema_migrations`, so the new runner tried to re-create existing tables | `relation "plans" already exists` on startup | Rebuilt the database from scratch; renamed migrations to zero-padded names so they always sort correctly |
| 6 | `STRIPE_PRO_PRICE_ID` left in `.env` meant the seed wrote a real Stripe price id while running in mock mode, so mock fixtures no longer mapped to a plan | The worker retried 5 times then logged `ALERT ... no plan mapped to price price_mock_pro` — my own alerting caught it | Seed now picks the price id based on `PAYMENT_PROVIDER` |
| 7 | Static webhook fixtures hardcoded `sub_test_demo1`, so after any re-seed they pointed at a subscription that no longer existed | Tenant stayed `active` when I expected `past_due`; the inbox showed `unknown subscription` | Wrote `scripts/send-subscription-event.js`, which reads the live subscription and price id from the database and stamps a fresh event id and timestamp; deleted the stale fixtures |
| 8 | Malformed JSON returned an HTML error page with a stack trace and my file paths | Testing bad input deliberately | Added an error handler that returns a clean `400 invalid_json` |
| 9 | Editing `src/seed.js` seemed to have no effect | The container runs the code baked into the image | `docker compose up -d --build` after source changes, not just `up -d` |

## Things that were my own environment, not the AI's fault

- PowerShell treats `a,b,c` as an array and joins it with spaces for external programs, which
  made `stripe listen --events ...` fail until I quoted the list. Same class of problem as
  JSON bodies in curl, which I solved by putting the body in a file.
- `localhost` on Windows can resolve to IPv6 first, so I switched `DATABASE_URL` to `127.0.0.1`.

## Stripe and my location

Stripe does not support accounts in Pakistan, so I asked on the portal and was told I could
continue "using the SDK with mocked/test fixtures". I built the mock provider behind an
interface so the rest of the system is identical in both modes, and later verified the real
path using a sandbox account in test mode . Mock stays the default.

## What I can explain

The metering transaction in `src/meter.js` (why the tenant row is locked, why the duplicate
check comes before the quota check), the rule in `src/quota.js`, the cost formula in
`src/pricing.js` (why cached tokens are subtracted from input, why nano dollars), and the
verify then store once path in `src/webhooks.js`.

Parts I understand but would need to re-read before changing: the exact backoff arithmetic in
`src/worker.js` and the `FOR UPDATE SKIP LOCKED` queue pattern.
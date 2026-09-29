ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'past_due'));
ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT UNIQUE;

ALTER TABLE plans ADD COLUMN monthly_price_cents INT NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN stripe_price_id TEXT UNIQUE;

CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY,
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan_id                TEXT NOT NULL REFERENCES plans(id),
  status                 TEXT NOT NULL,              
  current_period_end     TIMESTAMPTZ,
  last_event_at          TIMESTAMPTZ,               
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id);

CREATE TABLE checkout_sessions (
  id         TEXT PRIMARY KEY,                       
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  plan_id    TEXT NOT NULL REFERENCES plans(id),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id              TEXT PRIMARY KEY,                 
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processed', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX webhook_events_due_idx ON webhook_events (next_attempt_at) WHERE status = 'pending';
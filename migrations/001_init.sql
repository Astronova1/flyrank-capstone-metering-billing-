CREATE TABLE plans (
  id             TEXT PRIMARY KEY,          
  name           TEXT NOT NULL,
  api_call_limit BIGINT NOT NULL,           
  ai_token_limit BIGINT NOT NULL
);            

CREATE TABLE tenants (
  id           UUID PRIMARY KEY,
  name         TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,        
  plan_id      TEXT NOT NULL REFERENCES plans(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_events (
  id                  UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  period              CHAR(7) NOT NULL,     
  idempotency_key     TEXT NOT NULL,
  request_hash        TEXT NOT NULL,        
  api_calls           BIGINT NOT NULL,
  input_tokens        BIGINT NOT NULL,
  cached_input_tokens BIGINT NOT NULL,
  output_tokens       BIGINT NOT NULL,
  reasoning_tokens    BIGINT NOT NULL,
  response_body       JSON NOT NULL,       
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (cached_input_tokens <= input_tokens),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX usage_events_tenant_period_idx ON usage_events (tenant_id, period);
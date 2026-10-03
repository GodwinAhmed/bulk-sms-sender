-- BulkSMS Sender schema (Neon Postgres). Safe to run more than once.

CREATE TABLE IF NOT EXISTS campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,                       -- Clerk user id
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  status           text NOT NULL DEFAULT 'sending',     -- sending | completed
  template         text NOT NULL,
  phone_column     text NOT NULL,
  country_prefix   text NOT NULL,
  file_name        text,
  file_key         text,                                -- R2 key of the uploaded spreadsheet
  report_key       text,                                -- R2 key of the delivery report CSV
  total_recipients integer NOT NULL DEFAULT 0,
  total_sent       integer NOT NULL DEFAULT 0,
  total_errors     integer NOT NULL DEFAULT 0,
  total_credits    numeric(12, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS campaigns_user_created_idx
  ON campaigns (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_messages (
  id           bigserial PRIMARY KEY,
  campaign_id  uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  recipient    text NOT NULL,
  body         text NOT NULL,
  status       text NOT NULL,                           -- BulkSMS status type, or ERROR
  message_id   text,
  credit_cost  numeric(10, 2),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_messages_campaign_idx
  ON campaign_messages (campaign_id, id);

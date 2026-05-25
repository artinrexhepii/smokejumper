CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'diagnosed', 'resolved')),
  severity text NOT NULL,
  title text NOT NULL,
  service text NOT NULL,
  dedup_key text NOT NULL,
  labels jsonb NOT NULL DEFAULT '{}',
  alert_count integer NOT NULL DEFAULT 1,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_alert_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX incidents_dedup_idx ON incidents (project_id, dedup_key, status);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id),
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

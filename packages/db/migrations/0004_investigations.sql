CREATE TABLE investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'budget_exceeded')),
  budget jsonb NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE evidence_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  seq integer NOT NULL,
  tool_name text NOT NULL,
  input jsonb NOT NULL,
  output jsonb NOT NULL,
  summary text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, seq)
);

CREATE TABLE findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  specialist text NOT NULL,
  summary text NOT NULL,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES investigations(id),
  version integer NOT NULL DEFAULT 1,
  root_cause text NOT NULL,
  confidence real NOT NULL,
  evidence_chain jsonb NOT NULL,
  remediation text NOT NULL,
  open_questions text[] NOT NULL DEFAULT '{}',
  human_verdict text CHECK (human_verdict IN ('confirmed', 'rejected', 'partial')),
  human_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, version)
);

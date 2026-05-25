CREATE TABLE plugin_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  plugin_id text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  credentials_encrypted text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

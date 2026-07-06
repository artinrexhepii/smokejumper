CREATE TABLE runbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('upload', 'paste', 'url')),
  source_ref text,
  content text NOT NULL,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

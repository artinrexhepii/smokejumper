CREATE TABLE incident_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  generated jsonb NOT NULL,
  edited jsonb,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

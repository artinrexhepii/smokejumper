CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invites_org_idx ON invites(org_id);

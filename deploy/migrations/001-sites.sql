CREATE TABLE sites (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  site_id uuid NOT NULL,
  domain text NOT NULL CHECK (length(domain) BETWEEN 1 AND 253),
  state text NOT NULL CHECK (state IN ('creating', 'active', 'deleting', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id),
  UNIQUE (domain)
);
REVOKE ALL ON sites FROM PUBLIC;

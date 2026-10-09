CREATE TABLE site_content (
  tenant_id text NOT NULL,
  site_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483647),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1500000),
  PRIMARY KEY (tenant_id, site_id),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, site_id) ON DELETE CASCADE
);
REVOKE ALL ON site_content FROM PUBLIC;

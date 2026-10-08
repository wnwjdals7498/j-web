ALTER TABLE sites ADD COLUMN account_name text CHECK (account_name ~ '^jw-[a-z0-9]{4,24}$');
ALTER TABLE sites ADD COLUMN operation_phase text NOT NULL DEFAULT 'unmanaged'
  CHECK (operation_phase IN ('unmanaged','site_create','account_create','nginx_apply','active','delete','failed'));
ALTER TABLE sites ADD COLUMN last_error text CHECK (last_error ~ '^[a-z0-9_]{1,64}$');

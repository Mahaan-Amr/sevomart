create table platform_seed_resources (
  namespace varchar(120) not null,
  resource_key varchar(160) not null,
  resource_id uuid not null,
  manifest_version integer not null check (manifest_version > 0),
  content_checksum char(64) not null check (content_checksum ~ '^[0-9a-f]{64}$'),
  status varchar(16) not null check (status in ('ACTIVE', 'RETIRED')),
  updated_at timestamptz(3) not null,
  primary key (namespace, resource_key),
  unique (namespace, resource_id)
);

create index platform_seed_resources_namespace_status_idx
  on platform_seed_resources (namespace, status);

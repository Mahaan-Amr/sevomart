create table platform_data_environment (
  singleton boolean primary key default true check (singleton),
  fingerprint uuid not null unique default gen_random_uuid(),
  profile varchar(16) not null check (profile in ('local', 'staging', 'qa', 'unknown')),
  database_name text not null,
  created_at timestamptz(3) not null default now()
);

insert into platform_data_environment (profile, database_name)
values (
  case
    when current_database() = 'sevo' then 'local'
    when current_database() like 'sevo_demo%' then 'staging'
    when current_database() like 'sevo_qa_%' then 'qa'
    else 'unknown'
  end,
  current_database()
);

create table platform_seed_manifest_receipts (
  namespace varchar(120) primary key,
  manifest_version integer not null check (manifest_version > 0),
  target_fingerprint uuid not null references platform_data_environment(fingerprint),
  report jsonb not null,
  applied_at timestamptz(3) not null default now()
);

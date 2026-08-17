create table "media_assets" (
  "id" uuid primary key,
  "owner_seller_id" uuid not null,
  "purpose" varchar(24) not null check ("purpose" in ('STORE_LOGO', 'STORE_COVER')),
  "original_object_key" varchar(255) not null unique,
  "original_mime_type" varchar(32) not null,
  "original_size" integer not null check ("original_size" > 0),
  "original_checksum" char(64) not null,
  "width" integer not null check ("width" > 0),
  "height" integer not null check ("height" > 0),
  "visibility" varchar(16) not null default 'PRIVATE' check ("visibility" in ('PRIVATE', 'PUBLIC')),
  "created_at" timestamptz(3) not null default now()
);

create index "media_assets_owner_seller_id_created_at_idx"
  on "media_assets" ("owner_seller_id", "created_at");

create table "media_variants" (
  "id" uuid primary key,
  "media_id" uuid not null references "media_assets"("id") on delete cascade,
  "name" varchar(32) not null check ("name" in ('logo-small', 'logo-large', 'cover-mobile', 'cover-desktop')),
  "object_key" varchar(255) not null unique,
  "mime_type" varchar(32) not null default 'image/webp',
  "size" integer not null check ("size" > 0),
  "width" integer not null check ("width" > 0),
  "height" integer not null check ("height" > 0),
  unique ("media_id", "name")
);

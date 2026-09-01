import { randomUUID } from "node:crypto";

import type { RuntimeEnvironment } from "@sevo/config";
import type { MediaVariant } from "@sevo/contracts/media/v1";
import { Client } from "minio";
import postgres, { type Sql } from "postgres";

import type { MediaStorage, StoredMedia, StoredMediaPurpose } from "../public";

type MediaRow = {
  key: string;
  purpose: StoredMediaPurpose;
  originalContentType: "image/jpeg" | "image/png" | "image/webp";
  checksum: string;
  width: number;
  height: number;
  ownerSellerId: string;
  ownerReferenceId: string | null;
  visibility: "PRIVATE" | "PUBLIC";
  variant: MediaVariant;
  objectKey: string;
};

export class PostgresMinioMediaStorage implements MediaStorage {
  readonly #sql: Sql;
  readonly #client: Client;
  readonly #bucket: string;
  #ready: Promise<void> | undefined;

  constructor(environment: RuntimeEnvironment) {
    this.#sql = postgres(environment.DATABASE_URL, { max: 5 });
    this.#bucket = environment.MINIO_BUCKET;
    this.#client = new Client({
      endPoint: environment.MINIO_ENDPOINT,
      port: environment.MINIO_PORT,
      useSSL: environment.MINIO_USE_SSL,
      accessKey: environment.MINIO_ACCESS_KEY,
      secretKey: environment.MINIO_SECRET_KEY,
    });
  }

  async onModuleInit() {
    await this.#ensureBucket();
  }

  async put(object: StoredMedia): Promise<void> {
    await this.#ensureBucket();
    const originalKey = `media/${object.key}/original`;
    const uploadedKeys: string[] = [];
    try {
      await this.#client.putObject(
        this.#bucket,
        originalKey,
        Buffer.from(object.bytes),
        object.bytes.byteLength,
        { "Content-Type": object.contentType, "x-amz-meta-sha256": object.checksum },
      );
      uploadedKeys.push(originalKey);
      for (const variant of object.variants) {
        await this.#client.putObject(
          this.#bucket,
          variant.key,
          Buffer.from(variant.bytes),
          variant.bytes.byteLength,
          { "Content-Type": variant.contentType },
        );
        uploadedKeys.push(variant.key);
      }
      await this.#sql.begin(async (sql) => {
        await sql`
          insert into media_assets
            (id, owner_seller_id, owner_reference_id, purpose, original_object_key,
             original_mime_type, original_size, original_checksum, width, height,
             visibility)
          values
            (${object.key}, ${object.ownerSellerId}, ${object.ownerReferenceId ?? null},
             ${object.purpose}, ${originalKey}, ${object.contentType},
             ${object.bytes.byteLength}, ${object.checksum}, ${object.width},
             ${object.height}, ${object.visibility})
        `;
        await sql`
          insert into media_variants ${sql(
            object.variants.map((variant) => ({
              id: randomUUID(),
              media_id: object.key,
              name: variant.name,
              object_key: variant.key,
              mime_type: variant.contentType,
              size: variant.bytes.byteLength,
              width: variant.width,
              height: variant.height,
            })),
          )}
        `;
      });
    } catch (error) {
      await Promise.allSettled(
        uploadedKeys.map((key) => this.#client.removeObject(this.#bucket, key)),
      );
      throw error;
    }
  }

  async get(key: string, requestedVariant?: MediaVariant) {
    const rows = await this.#sql<MediaRow[]>`
      select a.id as key, a.purpose, a.original_mime_type as "originalContentType",
        a.original_checksum as checksum, a.width, a.height,
        a.owner_seller_id as "ownerSellerId",
        a.owner_reference_id as "ownerReferenceId", a.visibility,
        v.name as variant, v.object_key as "objectKey"
      from media_assets a
      join media_variants v on v.media_id = a.id
      where a.id = ${key}
        and v.name = coalesce(
          ${requestedVariant ?? null},
          case
            when a.purpose in ('CONVERSATION_ATTACHMENT', 'DISPUTE_EVIDENCE') then 'attachment-preview'
            when a.purpose = 'STORE_LOGO' then 'logo-large'
            when a.purpose = 'STORE_COVER' then 'cover-desktop'
            else 'product-detail'
          end
        )
      limit 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    await this.#ensureBucket();
    const bytes = await streamToBuffer(
      await this.#client.getObject(this.#bucket, row.objectKey),
    );
    return {
      key: row.key,
      purpose: row.purpose,
      contentType: "image/webp" as const,
      bytes,
      checksum: row.checksum,
      width: row.width,
      height: row.height,
      ownerSellerId: row.ownerSellerId,
      ownerReferenceId: row.ownerReferenceId ?? undefined,
      visibility: row.visibility,
      variant: row.variant,
    };
  }

  async inspect(key: string) {
    const rows = await this.#sql<
      Array<{
        key: string;
        purpose: StoredMediaPurpose;
        contentType: "image/jpeg" | "image/png" | "image/webp";
        checksum: string;
        width: number;
        height: number;
        ownerSellerId: string;
        ownerReferenceId: string | null;
        visibility: "PRIVATE" | "PUBLIC";
      }>
    >`
      select id as key, purpose, original_mime_type as "contentType",
        original_checksum as checksum, width, height,
        owner_seller_id as "ownerSellerId",
        owner_reference_id as "ownerReferenceId", visibility
      from media_assets where id = ${key}::uuid
      limit 1
    `;
    const row = rows[0];
    return row
      ? { ...row, ownerReferenceId: row.ownerReferenceId ?? undefined }
      : undefined;
  }

  async makePublic(key: string, ownerSellerId: string): Promise<void> {
    await this.#setVisibility(key, ownerSellerId, "PUBLIC");
  }

  async makePrivate(key: string, ownerSellerId: string): Promise<void> {
    await this.#setVisibility(key, ownerSellerId, "PRIVATE");
  }

  async #setVisibility(
    key: string,
    ownerSellerId: string,
    visibility: "PRIVATE" | "PUBLIC",
  ) {
    const result = await this.#sql`
      update media_assets set visibility = ${visibility}
      where id = ${key} and owner_seller_id = ${ownerSellerId}
        and (purpose not in ('CONVERSATION_ATTACHMENT', 'DISPUTE_EVIDENCE') or ${visibility} = 'PRIVATE')
      returning id
    `;
    if (!result.length) throw new Error("Media is not owned by the publishing seller");
  }

  async #ensureBucket() {
    this.#ready ??= (async () => {
      if (!(await this.#client.bucketExists(this.#bucket))) {
        await this.#client.makeBucket(this.#bucket);
      }
    })();
    return this.#ready;
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

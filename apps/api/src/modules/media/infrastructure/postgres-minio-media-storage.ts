import { randomUUID } from "node:crypto";

import type { RuntimeEnvironment } from "@sevo/config";
import {
  purchaseExperienceMediaContextIdContract,
  type MediaVariant,
  type PurchaseExperienceMediaContextId,
} from "@sevo/contracts/media/v1";
import { orderItemIdContract, type OrderItemId } from "@sevo/contracts/orders/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { Client } from "minio";
import postgres, { type Sql } from "postgres";

import {
  type MediaStorage,
  type MediaMetadata,
  PurchaseExperienceMediaIdempotencyConflictError,
  PurchaseExperienceMediaLimitError,
  type StoredMedia,
  type StoredMediaPurpose,
} from "../public";
import {
  mediaPurposePolicy,
  privateContextMediaPurposes,
} from "../media-purpose-policy";

type PurchaseExperienceWrite = Parameters<
  MediaStorage["putPurchaseExperienceMedia"]
>[0];

type MediaRow = {
  key: string;
  purpose: StoredMediaPurpose;
  originalContentType: "image/jpeg" | "image/png" | "image/webp";
  checksum: string;
  width: number;
  height: number;
  ownerIdentityId: string;
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
    const uploadedKeys = await this.#uploadObjects(object, originalKey);
    try {
      await this.#sql.begin(async (sql) => {
        await this.#insertMedia(sql, object, originalKey);
      });
    } catch (error) {
      await Promise.allSettled(
        uploadedKeys.map((key) => this.#client.removeObject(this.#bucket, key)),
      );
      throw error;
    }
  }

  async issuePurchaseExperienceUploadContext(input: {
    identityId: ReturnType<typeof identityIdContract.parse>;
    orderItemId: OrderItemId;
    expiresAt: Date;
  }) {
    const contextId = purchaseExperienceMediaContextIdContract.parse(randomUUID());
    const [row] = await this.#sql<Array<{ contextId: string; expiresAt: Date }>>`
      insert into media_purchase_experience_upload_contexts
        (id, identity_id, order_item_id, expires_at)
      values (${contextId}, ${input.identityId}, ${input.orderItemId}, ${input.expiresAt})
      on conflict (identity_id, order_item_id) do update
        set expires_at = greatest(
          media_purchase_experience_upload_contexts.expires_at,
          excluded.expires_at
        )
      returning id as "contextId", expires_at as "expiresAt"
    `;
    return {
      contextId: purchaseExperienceMediaContextIdContract.parse(row!.contextId),
      expiresAt: row!.expiresAt,
    };
  }

  async readPurchaseExperienceUploadContext(
    contextId: PurchaseExperienceMediaContextId,
    options: { includeExpired?: boolean } = {},
  ) {
    const [row] = await this.#sql<
      Array<{ identityId: string; orderItemId: string; expiresAt: Date }>
    >`
      select identity_id as "identityId", order_item_id as "orderItemId",
        expires_at as "expiresAt"
      from media_purchase_experience_upload_contexts
      where id = ${contextId}::uuid
        and (${options.includeExpired ?? false} or expires_at > now())
      limit 1
    `;
    return row
      ? {
          ...row,
          identityId: identityIdContract.parse(row.identityId),
          orderItemId: orderItemIdContract.parse(row.orderItemId),
        }
      : undefined;
  }

  async putPurchaseExperienceMedia(
    input: PurchaseExperienceWrite,
  ): Promise<MediaMetadata> {
    await this.#ensureBucket();
    const originalKey = `media/${input.object.key}/original`;
    const preflightReplay = await this.#sql.begin((sql) =>
      this.#checkPurchaseExperienceWrite(sql, input),
    );
    if (preflightReplay) return this.#requireMetadata(preflightReplay);
    const uploadedKeys = await this.#uploadObjects(input.object, originalKey);
    try {
      const outcome = await this.#sql.begin(async (sql) => {
        const replayMediaId = await this.#checkPurchaseExperienceWrite(sql, input);
        if (replayMediaId) return { kind: "replay", mediaId: replayMediaId } as const;
        await this.#insertMedia(sql, input.object, originalKey);
        await sql`
          insert into media_purchase_experience_upload_idempotency
            (context_id, idempotency_key, request_hash, media_id)
          values
            (${input.contextId}, ${input.idempotencyKey}, ${input.requestHash},
             ${input.object.key})
        `;
        return {
          kind: "created",
          metadata: {
            key: input.object.key,
            purpose: input.object.purpose,
            contentType: input.object.contentType,
            checksum: input.object.checksum,
            width: input.object.width,
            height: input.object.height,
            ownerIdentityId: input.object.ownerIdentityId,
            ownerReferenceId: input.object.ownerReferenceId,
            visibility: input.object.visibility,
          },
        } as const;
      });
      if (outcome.kind === "created") return outcome.metadata;
      if (outcome.mediaId) {
        await this.#removeObjects(uploadedKeys);
        return this.#requireMetadata(outcome.mediaId);
      }
      throw new Error("Purchase experience media write returned no outcome");
    } catch (error) {
      await this.#removeObjects(uploadedKeys);
      throw error;
    }
  }

  async get(key: string, requestedVariant?: MediaVariant) {
    const rows = await this.#sql<MediaRow[]>`
      select a.id as key, a.purpose, a.original_mime_type as "originalContentType",
        a.original_checksum as checksum, a.width, a.height,
        a.owner_identity_id as "ownerIdentityId",
        a.owner_reference_id as "ownerReferenceId", a.visibility,
        v.name as variant, v.object_key as "objectKey"
      from media_assets a
      join media_variants v on v.media_id = a.id
      where a.id = ${key}
    `;
    const purpose = rows[0]?.purpose;
    const selectedVariant = purpose
      ? (requestedVariant ?? mediaPurposePolicy(purpose).canonicalVariant)
      : requestedVariant;
    const row = rows.find((candidate) => candidate.variant === selectedVariant);
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
      ownerIdentityId: identityIdContract.parse(row.ownerIdentityId),
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
        ownerIdentityId: string;
        ownerReferenceId: string | null;
        visibility: "PRIVATE" | "PUBLIC";
      }>
    >`
      select id as key, purpose, original_mime_type as "contentType",
        original_checksum as checksum, width, height,
        owner_identity_id as "ownerIdentityId",
        owner_reference_id as "ownerReferenceId", visibility
      from media_assets where id = ${key}::uuid
      limit 1
    `;
    const row = rows[0];
    return row
      ? {
          ...row,
          ownerIdentityId: identityIdContract.parse(row.ownerIdentityId),
          ownerReferenceId: row.ownerReferenceId ?? undefined,
        }
      : undefined;
  }

  async makePublic(
    key: string,
    ownerIdentityId: ReturnType<typeof identityIdContract.parse>,
  ): Promise<void> {
    await this.#setVisibility(key, ownerIdentityId, "PUBLIC");
  }

  async makePrivate(
    key: string,
    ownerIdentityId: ReturnType<typeof identityIdContract.parse>,
  ): Promise<void> {
    await this.#setVisibility(key, ownerIdentityId, "PRIVATE");
  }

  async #setVisibility(
    key: string,
    ownerIdentityId: ReturnType<typeof identityIdContract.parse>,
    visibility: "PRIVATE" | "PUBLIC",
  ) {
    const result = await this.#sql`
      update media_assets set visibility = ${visibility}
      where id = ${key} and owner_identity_id = ${ownerIdentityId}
        and (not (purpose = any(${privateContextMediaPurposes})) or ${visibility} = 'PRIVATE')
      returning id
    `;
    if (!result.length) throw new Error("Media is not owned by the publishing seller");
  }

  async #checkPurchaseExperienceWrite(
    sql: Sql,
    input: PurchaseExperienceWrite,
  ): Promise<string | undefined> {
    const [context] = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId"
      from media_purchase_experience_upload_contexts
      where id = ${input.contextId}::uuid and expires_at > now()
      for update
    `;
    if (!context || context.identityId !== input.object.ownerIdentityId) {
      throw new Error("Purchase experience media context is unavailable");
    }
    const [replay] = await sql<Array<{ requestHash: string; mediaId: string }>>`
      select request_hash as "requestHash", media_id as "mediaId"
      from media_purchase_experience_upload_idempotency
      where context_id = ${input.contextId}::uuid
        and idempotency_key = ${input.idempotencyKey}
    `;
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        throw new PurchaseExperienceMediaIdempotencyConflictError();
      }
      return replay.mediaId;
    }
    const [{ count = 0 } = {}] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from media_assets
      where purpose = 'PURCHASE_EXPERIENCE_IMAGE'
        and owner_reference_id = ${input.contextId}::uuid
    `;
    if (count >= input.maxItems) throw new PurchaseExperienceMediaLimitError();
    return undefined;
  }

  async #requireMetadata(mediaId: string) {
    const metadata = await this.inspect(mediaId);
    if (!metadata) throw new Error("Committed purchase experience media is missing");
    return metadata;
  }

  #removeObjects(keys: readonly string[]) {
    return Promise.allSettled(
      keys.map((key) => this.#client.removeObject(this.#bucket, key)),
    );
  }

  async #ensureBucket() {
    this.#ready ??= (async () => {
      if (!(await this.#client.bucketExists(this.#bucket))) {
        await this.#client.makeBucket(this.#bucket);
      }
    })();
    return this.#ready;
  }

  async #uploadObjects(object: StoredMedia, originalKey: string) {
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
      return uploadedKeys;
    } catch (error) {
      await Promise.allSettled(
        uploadedKeys.map((key) => this.#client.removeObject(this.#bucket, key)),
      );
      throw error;
    }
  }

  async #insertMedia(sql: Sql, object: StoredMedia, originalKey: string) {
    await sql`
      insert into media_assets
        (id, owner_identity_id, owner_reference_id, purpose, original_object_key,
         original_mime_type, original_size, original_checksum, width, height,
         visibility)
      values
        (${object.key}, ${object.ownerIdentityId}, ${object.ownerReferenceId ?? null},
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

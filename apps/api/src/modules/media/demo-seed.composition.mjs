import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Client } from "minio";

const assetFiles = ["burgundy.png", "cream.png", "green.png", "blue.png"];

export function createMediaDemoSeedAdapter(environment = process.env) {
  const bucket = environment.MINIO_BUCKET ?? "sevo-media";
  const client = new Client({
    endPoint: environment.MINIO_ENDPOINT ?? "127.0.0.1",
    port: Number(environment.MINIO_PORT ?? 9100),
    useSSL: environment.MINIO_USE_SSL === "true",
    accessKey: environment.MINIO_ACCESS_KEY ?? "sevo_local",
    secretKey: environment.MINIO_SECRET_KEY ?? "sevo_local_password",
  });

  return {
    async prepare(manifest, baseline) {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
      const objects = await materializeObjects(manifest, baseline);
      for (const object of objects) {
        for (const objectKey of [
          object.objectKey,
          ...Object.values(object.variantKeys),
        ]) {
          await client.putObject(bucket, objectKey, object.bytes, object.bytes.length, {
            "Content-Type": object.mimeType,
            "x-amz-meta-sha256": object.checksum,
          });
        }
      }
      return objects;
    },

    async converge({ sql, baseline, mediaObjects }) {
      const obsoleteObjectKeys = [];
      for (const object of mediaObjects) {
        const previous = await sql`
          select original_object_key as "originalObjectKey"
          from media_assets where id = ${object.id}
        `;
        const previousVariants = await sql`
          select object_key as "objectKey" from media_variants
          where media_id = ${object.id}
        `;
        await sql`
          insert into media_assets
            (id, owner_seller_id, owner_reference_id, purpose, original_object_key,
             original_mime_type, original_size, original_checksum, width, height,
             visibility, created_at)
          values (${object.id}, ${object.ownerSellerId}, ${object.ownerReferenceId},
            'PRODUCT_IMAGE', ${object.objectKey}, ${object.mimeType},
            ${object.bytes.length}, ${object.checksum}, ${object.width}, ${object.height},
            'PUBLIC', ${baseline.atDaysAgo(20)})
          on conflict (id) do update set original_object_key = excluded.original_object_key,
            owner_seller_id = excluded.owner_seller_id,
            owner_reference_id = excluded.owner_reference_id,
            original_mime_type = excluded.original_mime_type,
            original_size = excluded.original_size,
            original_checksum = excluded.original_checksum, visibility = 'PUBLIC'
        `;
        for (const name of ["product-card", "product-detail"]) {
          await sql`
            insert into media_variants
              (id, media_id, name, object_key, mime_type, size, width, height)
            values (${baseline.ids.id(`${object.key}.${name}`)}, ${object.id}, ${name},
              ${object.variantKeys[name]}, ${object.mimeType}, ${object.bytes.length},
              ${object.width}, ${object.height})
            on conflict (media_id, name) do update set object_key = excluded.object_key,
              mime_type = excluded.mime_type, size = excluded.size,
              width = excluded.width, height = excluded.height
          `;
        }
        obsoleteObjectKeys.push(
          ...previous.map(({ originalObjectKey }) => originalObjectKey),
          ...previousVariants.map(({ objectKey }) => objectKey),
        );
      }
      return obsoleteObjectKeys.filter(
        (key) =>
          !mediaObjects.some(
            (object) =>
              object.objectKey === key ||
              Object.values(object.variantKeys).includes(key),
          ),
      );
    },

    async retire({ sql, retired, id }) {
      const mediaIds = retired
        .filter(({ key }) => key.startsWith("product.") || key.startsWith("content."))
        .map(({ key }) => id(`${key}.media`));
      const objectKeys =
        mediaIds.length > 0
          ? await sql`
            select original_object_key as "objectKey" from media_assets
            where id = any(${mediaIds})
            union all
            select object_key as "objectKey" from media_variants
            where media_id = any(${mediaIds})
          `
          : [];
      if (mediaIds.length > 0)
        await sql`delete from media_assets where id = any(${mediaIds})`;
      return objectKeys.map(({ objectKey }) => objectKey);
    },

    async removeObjects(objectKeys) {
      await Promise.allSettled(
        objectKeys.map((key) => client.removeObject(bucket, key)),
      );
    },

    async objectExists(objectKey) {
      try {
        await client.statObject(bucket, objectKey);
        return true;
      } catch (error) {
        if (error?.code === "NotFound" || error?.code === "NoSuchKey") return false;
        throw error;
      }
    },
  };
}

async function materializeObjects(manifest, baseline) {
  const resources = manifest.resources.filter(
    ({ kind }) => kind === "product" || kind === "salesContent",
  );
  return Promise.all(
    resources.map(async (resource, index) => {
      const video = resource.kind === "salesContent" && resource.mediaKind === "VIDEO";
      const fileName = video ? "motion.webm" : assetFiles[index % assetFiles.length];
      const bytes = await readFile(
        new URL(`../../../../../ops/demo/assets/${fileName}`, import.meta.url),
      );
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const key = `${resource.key}.media`;
      const ownerStore = baseline.resources.get(resource.store);
      return {
        key,
        id: baseline.ids.id(key),
        ownerSellerId: baseline.ids.id(baseline.ownerKey(ownerStore)),
        ownerReferenceId: baseline.ids.id(resource.key),
        objectKey: `demo/${baseline.ids.id(`${resource.key}.media`)}/${checksum}/original`,
        variantKeys: {
          "product-card": `demo/${baseline.ids.id(`${resource.key}.media`)}/${checksum}/product-card`,
          "product-detail": `demo/${baseline.ids.id(`${resource.key}.media`)}/${checksum}/product-detail`,
        },
        mimeType: video ? "video/webm" : "image/png",
        width: video ? 480 : 960,
        height: video ? 480 : 720,
        checksum,
        bytes,
      };
    }),
  );
}

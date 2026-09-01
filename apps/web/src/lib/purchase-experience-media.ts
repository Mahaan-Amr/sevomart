import { mediaReferenceContract, type MediaReference } from "@sevo/contracts/media/v1";

export class PurchaseExperienceMediaUploadError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

export function preparePurchaseExperienceImageUpload(input: {
  contextId: string;
  file: File;
  idempotencyKey?: string;
  fetcher?: typeof fetch;
}) {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const fetcher = input.fetcher ?? fetch;
  return {
    idempotencyKey,
    async run(): Promise<MediaReference> {
      const form = new FormData();
      form.set("file", input.file);
      let response: Response;
      try {
        response = await fetcher(
          `/api/purchase-experience-media/${encodeURIComponent(input.contextId)}`,
          {
            method: "POST",
            headers: { "idempotency-key": idempotencyKey },
            body: form,
          },
        );
      } catch {
        throw new PurchaseExperienceMediaUploadError(
          "ارتباط برقرار نشد. تصویر را دوباره بارگذاری کنید.",
        );
      }
      const body = await readJson(response);
      if (!response.ok) {
        throw new PurchaseExperienceMediaUploadError(
          readPersianMessage(body) ??
            "بارگذاری تصویر انجام نشد. همان تصویر را دوباره امتحان کنید.",
        );
      }
      const parsed = mediaReferenceContract.safeParse(body);
      if (!parsed.success) {
        throw new PurchaseExperienceMediaUploadError(
          "پاسخ بارگذاری کامل نبود. دوباره تلاش کنید.",
        );
      }
      return parsed.data;
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function readPersianMessage(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string" &&
    /[\u0600-\u06ff]/.test(value.message)
  ) {
    return value.message;
  }
  return undefined;
}

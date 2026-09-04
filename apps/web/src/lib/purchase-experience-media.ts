import {
  purchaseExperienceMediaContextContract,
  type PurchaseExperienceMediaContext,
} from "@sevo/contracts/content/v2";
import { mediaReferenceContract, type MediaReference } from "@sevo/contracts/media/v1";

export class PurchaseExperienceMediaUploadError extends Error {
  constructor(
    readonly userMessage: string,
    readonly issueCode?: string,
  ) {
    super(userMessage);
  }
}

type ResponseContract<T> = {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error?: unknown };
};

async function runPreparedRequest<T>(input: {
  request: () => Promise<Response>;
  contract: ResponseContract<T>;
  networkMessage: string;
  responseMessage: string;
  invalidMessage: string;
}) {
  let response: Response;
  try {
    response = await input.request();
  } catch {
    throw new PurchaseExperienceMediaUploadError(input.networkMessage);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new PurchaseExperienceMediaUploadError(
      readPersianMessage(body) ?? input.responseMessage,
      readIssueCode(body),
    );
  }
  const parsed = input.contract.safeParse(body);
  if (!parsed.success) {
    throw new PurchaseExperienceMediaUploadError(input.invalidMessage);
  }
  return parsed.data;
}

export function preparePurchaseExperienceMediaContext(input: {
  orderItemId: string;
  idempotencyKey?: string;
  fetcher?: typeof fetch;
}) {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const fetcher = input.fetcher ?? fetch;
  return {
    idempotencyKey,
    async run(): Promise<PurchaseExperienceMediaContext> {
      return runPreparedRequest({
        request: () =>
          fetcher("/api/purchase-experiences/media-contexts", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": idempotencyKey,
            },
            body: JSON.stringify({ orderItemId: input.orderItemId }),
          }),
        contract: purchaseExperienceMediaContextContract,
        networkMessage: "ارتباط برقرار نشد. دوباره تلاش کنید.",
        responseMessage: "اجازه بارگذاری تصویر دریافت نشد. دوباره تلاش کنید.",
        invalidMessage: "پاسخ بارگذاری کامل نبود. دوباره تلاش کنید.",
      });
    },
  };
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
      return runPreparedRequest({
        request: () => {
          const form = new FormData();
          form.set("file", input.file);
          return fetcher(
            `/api/purchase-experience-media/${encodeURIComponent(input.contextId)}`,
            {
              method: "POST",
              headers: { "idempotency-key": idempotencyKey },
              body: form,
            },
          );
        },
        contract: mediaReferenceContract,
        networkMessage: "ارتباط برقرار نشد. تصویر را دوباره بارگذاری کنید.",
        responseMessage: "بارگذاری تصویر انجام نشد. همان تصویر را دوباره امتحان کنید.",
        invalidMessage: "پاسخ بارگذاری کامل نبود. دوباره تلاش کنید.",
      });
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

function readIssueCode(value: unknown) {
  if (typeof value !== "object" || value === null) return undefined;
  if ("code" in value && typeof value.code === "string") {
    if (value.code === "MEDIA_NOT_FOUND") return value.code;
  }
  if (!("details" in value) || typeof value.details !== "object" || !value.details) {
    return undefined;
  }
  if (!("issues" in value.details) || !Array.isArray(value.details.issues)) {
    return undefined;
  }
  const [issue] = value.details.issues;
  return typeof issue === "object" &&
    issue !== null &&
    "code" in issue &&
    typeof issue.code === "string"
    ? issue.code
    : undefined;
}

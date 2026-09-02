import {
  buyerDisputeMediaContextContract,
  mediaReferenceContract,
  type MediaReference,
} from "@sevo/contracts/media/v1";
import { buyerDisputeViewContract } from "@sevo/contracts/problem-follow-up/v1";
import { openDisputeInputV2Contract } from "@sevo/contracts/problem-follow-up/v2";

export class BuyerDisputeClientError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(userMessage);
  }
}

export async function issueBuyerDisputeMediaContext(
  orderId: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await safeFetch(fetcher, "/api/buyer/dispute-media-contexts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  return parseResponse(response, buyerDisputeMediaContextContract);
}

export function prepareBuyerDisputeImageUpload(input: {
  contextId: string;
  file: File;
  idempotencyKey?: string;
  fetcher?: typeof fetch;
}) {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  return {
    idempotencyKey,
    async run(): Promise<MediaReference> {
      const form = new FormData();
      form.set("file", input.file);
      const response = await safeFetch(
        input.fetcher ?? fetch,
        `/api/buyer/dispute-media/${encodeURIComponent(input.contextId)}`,
        {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: form,
        },
      );
      return parseResponse(response, mediaReferenceContract);
    },
  };
}

export function prepareOpenBuyerDispute(input: {
  body: unknown;
  idempotencyKey?: string;
  fetcher?: typeof fetch;
}) {
  const body = openDisputeInputV2Contract.parse(input.body);
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  return {
    idempotencyKey,
    async run() {
      const response = await safeFetch(input.fetcher ?? fetch, "/api/buyer/disputes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      return parseResponse(response, buyerDisputeViewContract);
    },
  };
}

async function safeFetch(fetcher: typeof fetch, input: string, init: RequestInit) {
  try {
    return await fetcher(input, init);
  } catch {
    throw new BuyerDisputeClientError(
      "NETWORK_ERROR",
      "ارتباط برقرار نشد. اطلاعات شما حفظ شده است؛ دوباره تلاش کنید.",
    );
  }
}

async function parseResponse<Output>(
  response: Response,
  contract: {
    safeParse(value: unknown): { success: true; data: Output } | { success: false };
  },
) {
  const value = await readJson(response);
  if (!response.ok) {
    const error = readApiError(value);
    throw new BuyerDisputeClientError(
      error.code,
      messageForCode(error.code) ??
        error.message ??
        "انجام این کار ممکن نشد. دوباره تلاش کنید.",
    );
  }
  const parsed = contract.safeParse(value);
  if (!parsed.success) {
    throw new BuyerDisputeClientError(
      "INVALID_RESPONSE",
      "پاسخ کامل نبود. دوباره تلاش کنید.",
    );
  }
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function readApiError(value: unknown) {
  if (typeof value !== "object" || value === null) return { code: "UNKNOWN" };
  const code =
    "code" in value && typeof value.code === "string" ? value.code : "UNKNOWN";
  const message =
    "message" in value &&
    typeof value.message === "string" &&
    /[\u0600-\u06ff]/.test(value.message)
      ? value.message
      : undefined;
  return { code, message };
}

function messageForCode(code: string): string | undefined {
  return (
    {
      WINDOW_CLOSED: "مهلت ثبت اختلاف برای این سفارش گذشته است.",
      NOT_FOUND: "این سفارش پیدا نشد یا به هویت شما تعلق ندارد.",
      VALIDATION_ERROR: "شرح یا تصویر معتبر نیست. موارد مشخص‌شده را بررسی کنید.",
      IDEMPOTENCY_CONFLICT:
        "اطلاعات این تلاش تغییر کرده است. صفحه را تازه کنید و دوباره ثبت کنید.",
    } as Record<string, string>
  )[code];
}

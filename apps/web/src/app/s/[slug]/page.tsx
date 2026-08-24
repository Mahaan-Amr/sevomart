import { publicStoreContract, type PublicStore } from "@sevo/contracts/store/v1";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import {
  ErrorStorefront,
  LoadingStorefront,
  ReadyStorefront,
  StorefrontPageFrame,
} from "./storefront-view";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

type StorefrontResult =
  { state: "ready"; store: PublicStore } | { state: "not-found" } | { state: "error" };

async function readPublishedStore(
  slug: string,
  cookieHeader: string,
): Promise<StorefrontResult> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/stores/${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
        headers: {
          "x-correlation-id": crypto.randomUUID(),
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
      },
    );
    if (response.status === 404) return { state: "not-found" };
    if (!response.ok) return { state: "error" };
    const parsed = publicStoreContract.safeParse(await response.json());
    return parsed.success && parsed.data.followerCount
      ? { state: "ready", store: parsed.data }
      : { state: "error" };
  } catch {
    return { state: "error" };
  }
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ follow?: string | string[] }>;
}) {
  const { slug } = await params;

  if (process.env.SEVO_RUNTIME_ENV === "test") {
    if (slug === "test-loading") {
      return (
        <StorefrontPageFrame>
          <LoadingStorefront />
        </StorefrontPageFrame>
      );
    }
    if (slug === "test-error") {
      return (
        <StorefrontPageFrame>
          <ErrorStorefront retryHref={`/s/${slug}`} />
        </StorefrontPageFrame>
      );
    }
  }

  const cookieStore = await cookies();
  const result = await readPublishedStore(slug, cookieStore.toString());
  const followIntent = (await searchParams).follow;
  if (result.state === "not-found") notFound();

  return (
    <StorefrontPageFrame>
      {result.state === "ready" ? (
        <ReadyStorefront
          store={result.store}
          autoFollow={
            (Array.isArray(followIntent) ? followIntent[0] : followIntent) === "1"
          }
        />
      ) : (
        <ErrorStorefront retryHref={`/s/${slug}`} />
      )}
    </StorefrontPageFrame>
  );
}

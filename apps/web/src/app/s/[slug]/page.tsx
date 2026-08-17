import { publicStoreContract, type PublicStore } from "@sevo/contracts/store/v1";
import { notFound } from "next/navigation";

import {
  ErrorStorefront,
  LoadingStorefront,
  ReadyStorefront,
  StorefrontPageFrame,
} from "./storefront-view";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

type StorefrontResult =
  { state: "ready"; store: PublicStore } | { state: "not-found" } | { state: "error" };

async function readPublishedStore(slug: string): Promise<StorefrontResult> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/v1/stores/${encodeURIComponent(slug)}`,
      {
        cache: "no-store",
        headers: { "x-correlation-id": crypto.randomUUID() },
      },
    );
    if (response.status === 404) return { state: "not-found" };
    if (!response.ok) return { state: "error" };
    const parsed = publicStoreContract.safeParse(await response.json());
    return parsed.success ? { state: "ready", store: parsed.data } : { state: "error" };
  } catch {
    return { state: "error" };
  }
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
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

  const result = await readPublishedStore(slug);
  if (result.state === "not-found") notFound();

  return (
    <StorefrontPageFrame>
      {result.state === "ready" ? (
        <ReadyStorefront store={result.store} />
      ) : (
        <ErrorStorefront retryHref={`/s/${slug}`} />
      )}
    </StorefrontPageFrame>
  );
}

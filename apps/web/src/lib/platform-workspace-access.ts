import {
  platformAgentWorkspaceSessionContract,
  platformAgentWorkspaceV1Paths,
  type PlatformAgentWorkspaceSession,
  type PlatformPermission,
} from "@sevo/contracts/identity-access/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export type PlatformWorkspaceAccess =
  | { kind: "READY"; session: PlatformAgentWorkspaceSession }
  | { kind: "SIGNED_OUT" }
  | { kind: "UNAVAILABLE" };

export type PlatformDestination = {
  permission: PlatformPermission;
  href: string;
  label: string;
  shortLabel: string;
};

const platformDestinations: readonly PlatformDestination[] = [
  {
    permission: "SELLER_APPLICATION_REVIEW",
    href: "/platform/seller-applications",
    label: "بررسی درخواست‌های فروشندگی",
    shortLabel: "درخواست‌ها",
  },
  {
    permission: "PAYMENT_REVIEW",
    href: "/platform/payment-reviews",
    label: "بررسی پرداخت‌ها",
    shortLabel: "پرداخت‌ها",
  },
];

export async function readPlatformWorkspaceAccess(
  cookieHeader: string,
): Promise<PlatformWorkspaceAccess> {
  try {
    const response = await fetch(
      `${API_BASE_URL}${platformAgentWorkspaceV1Paths.readSession}`,
      {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      },
    );
    if (response.status === 401) return { kind: "SIGNED_OUT" };
    if (!response.ok) return { kind: "UNAVAILABLE" };
    const session = platformAgentWorkspaceSessionContract.safeParse(
      await response.json(),
    );
    return session.success
      ? { kind: "READY", session: session.data }
      : { kind: "UNAVAILABLE" };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

export function platformDestinationsFor(
  permissions: readonly PlatformPermission[],
): PlatformDestination[] {
  const livePermissions = new Set(permissions);
  return platformDestinations.filter(({ permission }) =>
    livePermissions.has(permission),
  );
}

export function platformEntryPath(
  permissions: readonly PlatformPermission[],
): string | null {
  if (permissions.length !== 1) return null;
  return platformDestinationsFor(permissions)[0]?.href ?? null;
}

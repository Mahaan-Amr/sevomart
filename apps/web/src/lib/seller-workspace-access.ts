import { mySellerApplicationsContract } from "@sevo/contracts/identity-access/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export type SellerWorkspaceAccess =
  | { kind: "ACTIVE" }
  | { kind: "APPLICANT" }
  | { kind: "INACTIVE" }
  | { kind: "SIGNED_OUT" }
  | { kind: "UNAVAILABLE" };

export async function readSellerWorkspaceAccess(
  cookieHeader: string,
): Promise<SellerWorkspaceAccess> {
  try {
    const accessResponse = await fetch(`${API_BASE_URL}/v1/seller/orders`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (accessResponse.status === 401) return { kind: "SIGNED_OUT" };
    if (accessResponse.status >= 500) return { kind: "UNAVAILABLE" };
    if (accessResponse.status !== 403) return { kind: "ACTIVE" };

    const applicationsResponse = await fetch(
      `${API_BASE_URL}/v1/seller-applications/mine?limit=20`,
      {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      },
    );
    if (applicationsResponse.status === 401) return { kind: "SIGNED_OUT" };
    if (!applicationsResponse.ok) return { kind: "UNAVAILABLE" };
    const applications = mySellerApplicationsContract.safeParse(
      await applicationsResponse.json(),
    );
    if (!applications.success) return { kind: "UNAVAILABLE" };
    return applications.data.items.some(({ status }) => status === "APPROVED")
      ? { kind: "INACTIVE" }
      : { kind: "APPLICANT" };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

import type { PlatformPermission } from "@sevo/contracts/identity-access/v1";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readPlatformWorkspaceAccess } from "../../../../lib/platform-workspace-access";
import { PlatformShell } from "./platform-shell";
import styles from "./platform-workspace.module.css";

export async function PlatformPermissionGate({
  children,
  permission,
  returnTo,
}: {
  children: React.ReactNode;
  permission: PlatformPermission;
  returnTo: string;
}) {
  const cookieStore = await cookies();
  const access = await readPlatformWorkspaceAccess(cookieStore.toString());
  if (access.kind === "SIGNED_OUT") {
    redirect(`/platform/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (access.kind === "UNAVAILABLE") {
    return <PlatformAccessStatus kind="UNAVAILABLE" returnTo={returnTo} />;
  }
  if (access.session.permissions.length === 0) {
    return <PlatformAccessStatus kind="NO_ACCESS" returnTo={returnTo} />;
  }

  return (
    <PlatformShell permissions={access.session.permissions}>
      {access.session.permissions.includes(permission) ? (
        children
      ) : (
        <PlatformAccessStatus kind="FORBIDDEN" returnTo={returnTo} />
      )}
    </PlatformShell>
  );
}

export function PlatformAccessStatus({
  kind,
  returnTo,
}: {
  kind: "NO_ACCESS" | "FORBIDDEN" | "UNAVAILABLE";
  returnTo: string;
}) {
  const unavailable = kind === "UNAVAILABLE";
  const forbidden = kind === "FORBIDDEN";
  return (
    <main className={styles.statusPage}>
      <section className={styles.statusPanel} aria-labelledby="platform-access-title">
        <span className={styles.eyebrow}>سوو · فضای کار پلتفرم</span>
        <h1 id="platform-access-title">
          {unavailable
            ? "وضعیت دسترسی دریافت نشد"
            : forbidden
              ? "این مسئولیت دیگر در دسترس نیست"
              : "مجوز فعالی برای این فضا ندارید"}
        </h1>
        <p>
          {unavailable
            ? "ارتباط با سرویس دسترسی برقرار نشد. کمی بعد دوباره بررسی کنید."
            : forbidden
              ? "مجوز این مسیر لغو شده یا تغییر کرده است. از خانه فقط مسئولیت‌های فعال را ببینید."
              : "اگر انتظار دارید مسئولیتی به شما واگذار شده باشد، با مدیر دسترسی پلتفرم پیگیری کنید."}
        </p>
        <div className={styles.statusActions}>
          <Link
            className={styles.primaryAction}
            href={unavailable ? returnTo : "/platform"}
          >
            {unavailable ? "بررسی دوباره" : "دیدن مسئولیت‌های فعال"}
          </Link>
          <form action="/api/platform/auth/logout" method="post">
            <button className={styles.secondaryAction} type="submit">
              خروج امن
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

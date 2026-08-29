import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readSellerWorkspaceAccess } from "../../../../lib/seller-workspace-access";
import styles from "./seller-gate.module.css";

export async function ActiveSellerGate({
  children,
  returnTo,
}: {
  children: React.ReactNode;
  returnTo: string;
}) {
  const cookieStore = await cookies();
  const access = await readSellerWorkspaceAccess(cookieStore.toString());

  if (access.kind === "SIGNED_OUT") {
    redirect(`/seller/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (access.kind === "APPLICANT") redirect("/seller/application");
  if (access.kind === "ACTIVE") return children;

  return (
    <SellerAccessStatus
      unavailable={access.kind === "UNAVAILABLE"}
      returnTo={returnTo}
    />
  );
}

export function SellerAccessStatus({
  unavailable,
  returnTo,
}: {
  unavailable: boolean;
  returnTo: string;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="seller-access-title">
        <span className={styles.brand}>سوو</span>
        <p className={styles.label}>
          {unavailable ? "بررسی دسترسی" : "وضعیت فروشندگی"}
        </p>
        <h1 id="seller-access-title">
          {unavailable ? "وضعیت فروشندگی دریافت نشد" : "فضای کار اکنون در دسترس نیست"}
        </h1>
        <p>
          {unavailable
            ? "ارتباط با سرویس برقرار نشد. کمی بعد دوباره وضعیت را بررسی کنید."
            : "فروشندگی فعال نیست. اگر انتظار دارید دسترسی فعال باشد، وضعیت تعلیق یا لغو را با پشتیبانی سوو پیگیری کنید."}
        </p>
        <div className={styles.actions}>
          <Link className={styles.primary} href={returnTo}>
            بررسی دوباره
          </Link>
          <Link className={styles.secondary} href="/">
            بازگشت به فضای خریدار
          </Link>
        </div>
      </section>
    </main>
  );
}

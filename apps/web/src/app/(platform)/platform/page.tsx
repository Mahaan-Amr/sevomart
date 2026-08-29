import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  platformDestinationsFor,
  platformEntryPath,
  readPlatformWorkspaceAccess,
} from "../../../lib/platform-workspace-access";
import { PlatformAccessStatus } from "./_components/platform-access-gate";
import { PlatformShell } from "./_components/platform-shell";
import styles from "./platform-home.module.css";

export const metadata: Metadata = {
  title: "مسئولیت‌های پلتفرم | سوو",
};

export default async function PlatformHomePage() {
  const cookieStore = await cookies();
  const access = await readPlatformWorkspaceAccess(cookieStore.toString());
  if (access.kind === "SIGNED_OUT") {
    redirect("/platform/login?returnTo=%2Fplatform");
  }
  if (access.kind === "UNAVAILABLE") {
    return <PlatformAccessStatus kind="UNAVAILABLE" returnTo="/platform" />;
  }
  if (access.session.permissions.length === 0) {
    return <PlatformAccessStatus kind="NO_ACCESS" returnTo="/platform" />;
  }
  const directDestination = platformEntryPath(access.session.permissions);
  if (directDestination) redirect(directDestination);

  const destinations = platformDestinationsFor(access.session.permissions);
  return (
    <PlatformShell permissions={access.session.permissions}>
      <main className={styles.page}>
        <section className={styles.workspace} aria-labelledby="platform-home-title">
          <span className={styles.eyebrow}>فضای کار پلتفرم</span>
          <h1 id="platform-home-title">مسئولیت‌های فعال شما</h1>
          <p>هر صف فقط تا وقتی مجوز همان مسئولیت فعال باشد در دسترس می‌ماند.</p>
          <nav className={styles.responsibilities} aria-label="مسئولیت‌های فعال">
            {destinations.map((destination) => (
              <Link
                className={styles.responsibility}
                href={destination.href}
                key={destination.permission}
              >
                <span>{destination.label}</span>
                <small>رفتن به صف</small>
              </Link>
            ))}
          </nav>
        </section>
      </main>
    </PlatformShell>
  );
}

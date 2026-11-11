import { firstParameter } from "../../../lib/navigation";
import { cookies } from "next/headers";
import {
  canInviteSeller,
  readSellerWorkspaceAccess,
} from "../../../lib/seller-workspace-access";
import { FeedView } from "./feed-view";
import { FeedTabs } from "./feed-tabs";
import styles from "./discovery.module.css";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  const cookieHeader = (await cookies()).toString();
  const access = cookieHeader
    ? await readSellerWorkspaceAccess(cookieHeader)
    : { kind: "SIGNED_OUT" as const };
  return (
    <>
      <section
        id="discovery-feed"
        className={styles.feedSection}
        aria-labelledby="discovery-title"
      >
        <h1 id="discovery-title">کشف تازه‌ها</h1>
        <FeedTabs />
        <FeedView
          kind="discovery"
          initialCursor={cursor}
          showSellerInvitation={canInviteSeller(access)}
        />
      </section>
    </>
  );
}

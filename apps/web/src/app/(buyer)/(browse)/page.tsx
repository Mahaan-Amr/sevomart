import { firstParameter } from "../../../lib/navigation";
import { FeedView } from "./feed-view";
import styles from "./discovery.module.css";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  return (
    <>
      <section
        id="discovery-feed"
        className={styles.feedSection}
        aria-labelledby="discovery-title"
      >
        <h1 id="discovery-title">کشف تازه‌ها</h1>
        <FeedView kind="discovery" initialCursor={cursor} />
      </section>
    </>
  );
}

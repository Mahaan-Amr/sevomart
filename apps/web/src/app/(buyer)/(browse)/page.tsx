import { firstParameter } from "../../../lib/navigation";
import { FeedView } from "./feed-view";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  return (
    <>
      <h1>کشف تازه‌ها</h1>
      <FeedView kind="discovery" initialCursor={cursor} />
    </>
  );
}

import { firstParameter } from "../../../lib/navigation";
import { DiscoveryView } from "./discovery-view";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  return (
    <>
      <h1>کشف تازه‌ها</h1>
      <DiscoveryView key={cursor ?? "first"} cursor={cursor} />
    </>
  );
}

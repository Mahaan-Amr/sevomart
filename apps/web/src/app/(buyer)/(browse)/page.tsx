import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { firstParameter } from "../../../lib/navigation";
import { readIdentitySession } from "../../../lib/identity-api-proxy";
import { FeedView } from "./feed-view";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = firstParameter((await searchParams).cursor);
  if (cursor) redirect(`/discover?${new URLSearchParams({ cursor })}`);
  const session = await readIdentitySession((await cookies()).toString());
  return (
    <section>
      <h1>خانه</h1>
      <FeedView
        key={session ? "following" : "discovery"}
        kind={session ? "following" : "discovery"}
      />
    </section>
  );
}

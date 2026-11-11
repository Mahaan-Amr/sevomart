import { cookies } from "next/headers";
import { readIdentitySession } from "../../../lib/identity-api-proxy";
import { FeedView } from "./feed-view";

export default async function HomePage() {
  const session = await readIdentitySession((await cookies()).toString());
  return (
    <section>
      <h1>خانه</h1>
      <FeedView
        layout="home"
        key={session ? "following" : "discovery"}
        kind={session ? "following" : "discovery"}
      />
    </section>
  );
}

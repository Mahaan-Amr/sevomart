import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { firstParameter } from "../../../lib/navigation";
import { readIdentitySession } from "../../../lib/identity-api-proxy";
import { FeedView } from "./feed-view";
import { HomePrototype } from "./home-prototype";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[];
    variant?: string | string[];
    theme?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const variant = firstParameter(params.variant);
  if (
    process.env.NODE_ENV === "development" &&
    (variant === "A" || variant === "B" || variant === "C")
  ) {
    return (
      <HomePrototype variant={variant} dark={firstParameter(params.theme) === "dark"} />
    );
  }
  const cursor = firstParameter(params.cursor);
  if (cursor) redirect(`/discover?${new URLSearchParams({ cursor })}`);
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

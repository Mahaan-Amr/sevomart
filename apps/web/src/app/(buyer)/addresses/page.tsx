import { redirect } from "next/navigation";
import { firstParameter, safeReturnPath } from "../../../lib/navigation";

export default async function LegacyAddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = safeReturnPath(
    firstParameter((await searchParams).returnTo),
    "/cart",
  );
  redirect(`/account/addresses?${new URLSearchParams({ returnTo })}`);
}

import { firstParameter, safeReturnPath } from "../../../../lib/navigation";
import { AddressView } from "../../addresses/address-view";

export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = safeReturnPath(firstParameter((await searchParams).returnTo), "/");
  return <AddressView returnTo={returnTo} />;
}

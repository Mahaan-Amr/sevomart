import { createHash } from "node:crypto";

const uuidNamespace = Buffer.from("3b7d2df5a9584bc99d0c87d1e2041630", "hex");

export function stableDemoId(key) {
  const bytes = createHash("sha1")
    .update(uuidNamespace)
    .update(`sevo.demo:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function checksumResource(resource) {
  return createHash("sha256").update(JSON.stringify(resource)).digest("hex");
}

export function manifestSummary(manifest) {
  const count = (kind) =>
    manifest.resources.filter((item) => item.kind === kind).length;
  return {
    loginIdentities: count("loginIdentity"),
    stores: count("store"),
    products: count("product"),
    salesContents: count("salesContent"),
    conversations: count("conversation"),
    orders: count("order"),
  };
}

export function manifestResources(manifest) {
  return manifest.resources.map((resource) => ({
    key: resource.key,
    kind: resource.kind,
    id: stableDemoId(resource.key),
    checksum: checksumResource(resource),
  }));
}

export function buildDemoBaseline(manifest, now = new Date()) {
  const resources = new Map(
    manifest.resources.map((resource) => [resource.key, resource]),
  );
  const id = (key) => stableDemoId(key);
  const atDaysAgo = (days = 0, minutes = 0) =>
    new Date(now.getTime() - days * 86_400_000 - minutes * 60_000);
  const stores = manifest.resources.filter(({ kind }) => kind === "store");
  const products = manifest.resources.filter(({ kind }) => kind === "product");
  const orders = manifest.resources.filter(({ kind }) => kind === "order");
  const ownerKey = (store) =>
    typeof store.owner === "string" ? store.owner : store.owner.key;
  const storeOwnerId = (storeKey) => id(ownerKey(resources.get(storeKey)));
  const variantsFor = (product) =>
    product.variants ?? [{ key: "simple", label: "پیش‌فرض", onHand: product.onHand }];
  const firstVariant = (productKey) =>
    id(`${productKey}.variant.${variantsFor(resources.get(productKey))[0].key}`);

  return {
    ids: { id, firstVariant, storeOwnerId },
    now,
    atDaysAgo,
    resources,
    stores,
    products,
    orders,
    ownerKey,
    variantsFor,
  };
}

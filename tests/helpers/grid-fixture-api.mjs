import { createServer } from "node:http";
import { storeV1Examples } from "@sevo/contracts/store/v1";
import { identityAccessV1Examples } from "@sevo/contracts/identity-access/v1";
import { discoveryV1Examples } from "@sevo/contracts/discovery/v1";

const store = {
  ...storeV1Examples.PublicStore,
  followerCount: {
    version: 1,
    storeId: storeV1Examples.PublicStore.id,
    count: 0,
    updatedAt: "2026-08-16T09:30:00.000Z",
  },
};
const product = (suffix) => ({
  productId: `0d113616-5ad8-45d2-a126-b5b3412b3dd${suffix}`,
  name: `فنجان دست‌ساز با نقش‌های ظریف شماره ${suffix}`,
  image: {
    id: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
    url: "/v1/media/807c619f-a989-4fd9-8b78-a437a07c7bc4",
  },
  priceRange: {
    minimum: { amount: 4500000, currency: "IRR" },
    maximum: { amount: 4500000, currency: "IRR" },
  },
  availability: "AVAILABLE",
  publicationVersion: 1,
});
const feedItem = discoveryV1Examples.DiscoveryFeedItemV1;
const feed = {
  ...discoveryV1Examples.DiscoveryFeedPageV1,
  emptyState: undefined,
  nextCursor: undefined,
  items: [1, 2, 3].map((n) => ({
    ...feedItem,
    productId: product(n).productId,
    product: { ...feedItem.product, name: product(n).name },
  })),
};
createServer((req, res) => {
  let body;
  if (req.url === "/health") body = { ok: true };
  else if (req.url === "/v1/auth/session" && req.headers.cookie?.includes("buyer=1"))
    body = identityAccessV1Examples.IdentitySession;
  else if (req.url === "/v1/stores/khane-sofal-mah") body = store;
  else if (req.url === "/v1/stores/khane-sofal-mah/products")
    body = { products: [1, 2, 3].map(product) };
  else if (req.url?.startsWith("/v1/feeds/discovery")) body = feed;
  else {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}).listen(3338, "127.0.0.1");

import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import {
  e2eApiBaseUrl,
  releaseAgentTestMobiles,
  releaseBuyerTestMobiles,
  releaseSellerTestMobiles,
  visualProjectIndex,
} from "../helpers/visual-projects";

const apiBaseUrl = e2eApiBaseUrl();

test("traces seller approval and publication through discovery, follow, payment and seller action", async ({
  playwright,
}, testInfo) => {
  const fixture = releaseFixture(testInfo.project.name, testInfo.retry);
  const seller = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const agentIdentity = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const agent = await playwright.request.newContext({ baseURL: apiBaseUrl });
  const buyer = await playwright.request.newContext({ baseURL: apiBaseUrl });

  try {
    const storeId = await provisionApprovedSeller(
      seller,
      agentIdentity,
      agent,
      fixture,
    );
    await publishStore(seller, fixture.slug, fixture.index);
    const product = await publishSellableProduct(seller);
    await expectProductInFeed(buyer, "/v1/feeds/discovery", product.productId);

    await signIn(buyer, fixture.buyerMobile);
    await followStore(buyer, storeId);
    await expectProductInFeed(buyer, "/v1/me/feeds/following", product.productId);
    const orderId = await completeBuyerPayment(buyer, product.variantId);
    await expectSellerActionableOrder(seller, orderId);
  } finally {
    await Promise.all([
      seller.dispose(),
      agentIdentity.dispose(),
      agent.dispose(),
      buyer.dispose(),
    ]);
  }
});

type ReleaseFixture = ReturnType<typeof releaseFixture>;
type CartSnapshot = { cartId: string; revision: number };
type CheckoutReview = {
  checkoutRevision: string;
  cart: { revision: number };
  shippingMethod: { revision: number };
  returnPolicy: { revision: number };
};
type PaymentAttempt = { attemptId: string; amount: { amount: number } };

function releaseFixture(projectName: string, retry: number) {
  const index = visualProjectIndex(projectName);
  const fixtureIndex = index + retry * 4;
  return {
    index,
    sellerMobile: releaseSellerTestMobiles[fixtureIndex]!,
    agentMobile: releaseAgentTestMobiles[fixtureIndex]!,
    buyerMobile: releaseBuyerTestMobiles[fixtureIndex]!,
    slug: `release-tracer-${index}-retry-${retry}`,
  };
}

async function provisionApprovedSeller(
  seller: APIRequestContext,
  agentIdentity: APIRequestContext,
  agent: APIRequestContext,
  fixture: ReleaseFixture,
) {
  await signIn(seller, fixture.sellerMobile);
  const submitted = await seller.post("/v1/seller-applications", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      applicantName: "نگار محمدی",
      proposedStoreName: `خانه ردیاب ${fixture.index}`,
      goodsAreaText: "فنجان سرامیکی دست‌ساز",
      currentSalesMethod: "فروش مستقیم در شبکه‌های اجتماعی",
    },
  });
  await expectOk(submitted, 201);
  const applicationId = (await submitted.json()).applicationId as string;

  await signIn(agentIdentity, fixture.agentMobile);
  grantPlatformPermission(await identityIdForMobile(fixture.agentMobile));
  await signIn(agent, fixture.agentMobile, true);
  const approved = await agent.post(
    `/v1/platform/seller-applications/${applicationId}/approval`,
    {
      headers: { "idempotency-key": randomUUID() },
      data: {
        expectedRevision: 1,
        reasonCode: "ELIGIBILITY_CONFIRMED",
        publicReason: "شرایط فروشندگی شما تأیید شد.",
      },
    },
  );
  await expectOk(approved, 200);
  return (await approved.json()).storeId as string;
}

async function publishStore(seller: APIRequestContext, slug: string, index: number) {
  const saved = await seller.put("/v1/seller/store/draft", {
    headers: writeHeaders(1),
    data: {
      name: `خانه ردیاب انتشار ${index}`,
      slug,
      bio: "فروشگاه واقعی ردیاب انتشار و خرید نسخه اول سوو",
      shippingMethods: [{ code: "PICKUP", label: "تحویل حضوری" }],
      returnPolicy: "تا هفت روز پس از تحویل امکان درخواست مرجوعی وجود دارد.",
      settlementDestination: { kind: "TEST" },
      logoMediaId: null,
      coverMediaId: null,
      themeColor: "#A41439",
    },
  });
  await expectOk(saved, 200);
  await expectOk(
    await seller.post("/v1/seller/store/publication", {
      headers: writeHeaders(2),
    }),
    200,
  );
}

async function publishSellableProduct(seller: APIRequestContext) {
  const created = await seller.post("/v1/seller/products", {
    headers: { "idempotency-key": randomUUID() },
    data: {},
  });
  await expectOk(created, 201);
  const productId = (await created.json()).productId as string;
  const mediaId = await uploadProductImage(seller, productId);
  await saveProductWorkingCopy(seller, productId, mediaId);
  const published = await seller.post(`/v1/seller/products/${productId}/publications`, {
    headers: writeHeaders(1),
    data: { expectedRevision: 1, confirmed: true },
  });
  await expectOk(published, 200);
  const body = (await published.json()) as { variantId: string };
  return { productId, variantId: body.variantId };
}

async function uploadProductImage(seller: APIRequestContext, productId: string) {
  const image = await sharp({
    create: { width: 800, height: 800, channels: 4, background: "#A41439" },
  })
    .png()
    .toBuffer();
  const uploaded = await seller.post(`/v1/seller/products/${productId}/images`, {
    multipart: {
      purpose: "PRODUCT_IMAGE",
      file: { name: "release-product.png", mimeType: "image/png", buffer: image },
    },
  });
  await expectOk(uploaded, 201);
  return (await uploaded.json()).id as string;
}

async function saveProductWorkingCopy(
  seller: APIRequestContext,
  productId: string,
  mediaId: string,
) {
  const saved = await seller.put(`/v1/seller/products/${productId}/working-copy`, {
    headers: writeHeaders(0),
    data: {
      expectedRevision: 0,
      workingCopy: {
        name: "فنجان سرامیکی ردیاب",
        description: "فنجان دست‌ساز مناسب نوشیدنی گرم",
        orderedMediaIds: [mediaId],
        variant: {
          clientKey: "simple",
          price: { amount: 4_500_000, currency: "IRR" },
        },
      },
      inventory: { onHand: 8, expectedRevision: 0 },
    },
  });
  await expectOk(saved, 200);
}

async function expectProductInFeed(
  context: APIRequestContext,
  path: string,
  productId: string,
) {
  await expect
    .poll(
      async () => {
        const response = await context.get(`${path}?limit=20`);
        if (response.status() !== 200) return false;
        const body = (await response.json()) as {
          items: Array<{ productId: string }>;
        };
        return body.items.some((item) => item.productId === productId);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function followStore(buyer: APIRequestContext, storeId: string) {
  await expectOk(
    await buyer.put(`/v1/me/follows/${storeId}`, {
      headers: { "idempotency-key": randomUUID() },
    }),
    200,
  );
}

async function completeBuyerPayment(buyer: APIRequestContext, variantId: string) {
  const added = await buyer.put(`/v1/cart/items/${variantId}`, {
    headers: { "idempotency-key": randomUUID() },
    data: { variantId, quantity: 1, expectedRevision: 0 },
  });
  await expectOk(added, 200);
  const review = await prepareCheckout(buyer, (await added.json()) as CartSnapshot);
  const order = await createOrder(buyer, review);
  const orderId = order.orderId as string;
  const attempt = await dispatchPayment(buyer, orderId);
  await confirmPayment(buyer, orderId, attempt);
  return orderId;
}

async function prepareCheckout(buyer: APIRequestContext, cart: CartSnapshot) {
  const optionsResponse = await buyer.get("/v1/checkout/options");
  await expectOk(optionsResponse, 200);
  const options = (await optionsResponse.json()) as {
    shippingMethods: Array<{ id: string; revision: number }>;
  };
  const shipping = options.shippingMethods[0];
  const prepared = await buyer.post("/v1/checkout/prepare", {
    data: {
      cartId: cart.cartId,
      cartRevision: cart.revision,
      shippingMethodId: shipping.id,
      shippingMethodRevision: shipping.revision,
    },
  });
  await expectOk(prepared, 200);
  return (await prepared.json()) as CheckoutReview;
}

async function createOrder(buyer: APIRequestContext, review: CheckoutReview) {
  const response = await buyer.post("/v1/orders", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      checkoutRevision: review.checkoutRevision,
      cartRevision: review.cart.revision,
      shippingMethodRevision: review.shippingMethod.revision,
      returnPolicyRevision: review.returnPolicy.revision,
    },
  });
  await expectOk(response, 201);
  return (await response.json()) as { orderId: string };
}

async function dispatchPayment(buyer: APIRequestContext, orderId: string) {
  const response = await buyer.post(`/v1/orders/${orderId}/payment-attempts`, {
    headers: { "idempotency-key": randomUUID() },
    data: {},
  });
  await expectOk(response, 201);
  return (await response.json()) as PaymentAttempt;
}

async function confirmPayment(
  buyer: APIRequestContext,
  orderId: string,
  attempt: PaymentAttempt,
) {
  const unsigned = {
    attemptId: attempt.attemptId as string,
    orderId,
    amount: attempt.amount.amount as number,
    result: "CONFIRMED" as const,
    providerEventId: `release-${attempt.attemptId}`,
  };
  const signature = createHmac("sha256", "sevo-local-dev-payment-fixture-secret")
    .update(Object.values(unsigned).join("."))
    .digest("hex");
  await expectOk(
    await buyer.post("/internal/v1/payment-providers/DEV/callbacks", {
      data: { ...unsigned, signature },
    }),
    200,
  );
}

async function expectSellerActionableOrder(seller: APIRequestContext, orderId: string) {
  const response = await seller.get("/v1/seller/orders");
  await expectOk(response, 200);
  expect((await response.json()).orders).toEqual(
    expect.arrayContaining([expect.objectContaining({ orderId })]),
  );
}

async function signIn(context: APIRequestContext, mobile: string, platform = false) {
  const prefix = platform ? "/v1/platform/auth/otp" : "/v1/auth/otp";
  const requested = await context.post(`${prefix}/requests`, { data: { mobile } });
  await expectOk(requested, 202);
  const challengeId = (await requested.json()).challengeId as string;
  await expectOk(
    await context.post(`${prefix}/verifications`, {
      data: { challengeId, code: "111111" },
    }),
    200,
  );
}

async function identityIdForMobile(mobile: string) {
  const sql = postgres(requiredDatabaseUrl(), { max: 1 });
  try {
    const rows = await sql<Array<{ identityId: string }>>`
      select identity_id as "identityId" from identity_login_methods
      where mobile = ${mobile}
    `;
    if (!rows[0]) throw new Error(`Identity was not created for ${mobile}`);
    return rows[0].identityId;
  } finally {
    await sql.end();
  }
}

function grantPlatformPermission(identityId: string) {
  const pnpmEntryPoint = process.env.npm_execpath;
  if (!pnpmEntryPoint) throw new Error("pnpm entry point is unavailable");
  const result = spawnSync(
    process.execPath,
    [
      pnpmEntryPoint,
      "platform:permission",
      "--",
      "--identity-id",
      identityId,
      "--reason",
      "آماده‌سازی عامل ردیاب پذیرش نسخه",
      "--idempotency-key",
      randomUUID(),
    ],
    { env: process.env, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
}

function writeHeaders(expectedRevision: number) {
  return {
    "idempotency-key": randomUUID(),
    "if-match": `"${expectedRevision}"`,
  };
}

async function expectOk(
  response: { status(): number; text(): Promise<string> },
  expectedStatus: number,
) {
  expect(response.status(), await response.text()).toBe(expectedStatus);
}

function requiredDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the E2E tracer");
  return databaseUrl;
}

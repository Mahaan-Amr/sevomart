import {
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";

export * from "@playwright/test";

const expectedCandidateResponses = [
  {
    status: 503,
    method: "POST",
    path: /^\/api\/auth\/otp\/requests$/,
    scenario: "login-recovery",
  },
  {
    status: 503,
    method: "POST",
    path: /^\/api\/platform\/seller-applications(?:\/.*)?$/,
    scenario: "platform-review-recovery",
  },
  {
    status: 503,
    method: "PUT",
    path: /^\/api\/store\/me\/follows\//,
    scenario: "following-recovery",
  },
  {
    status: 409,
    method: "DELETE",
    path: /^\/api\/store\/me\/follows\//,
    scenario: "following-conflict",
  },
  {
    status: 400,
    method: "PUT",
    path: /^\/api\/store\/seller\/products\/.*\/offers$/,
    scenario: "product-validation",
  },
  {
    status: 409,
    method: "POST",
    path: /^\/api\/seller\/orders\/.*\/fulfillment/,
    scenario: "fulfillment-conflict",
  },
  {
    status: 422,
    method: "POST",
    path: /^\/api\/store\/seller\/store\/publication$/,
    scenario: "store-validation",
  },
  {
    status: 503,
    method: "POST",
    path: /^\/api\/conversations\/.*\/messages$/,
    scenario: "conversation-recovery",
  },
  {
    status: 409,
    method: "POST",
    path: /^\/api\/seller\/disputes\/.*\/response$/,
    scenario: "dispute-conflict",
  },
  {
    status: 409,
    method: "GET",
    path: /^\/api\/following$/,
    scenario: "following-cursor-recovery",
  },
  {
    status: 401,
    method: "GET",
    path: /^\/api\/following$/,
    scenario: "following-sign-in",
  },
  {
    status: 403,
    method: "GET",
    path: /^\/api\/following$/,
    scenario: "following-auth-recovery",
  },
  {
    status: 401,
    method: "GET",
    path: /^\/api\/following$/,
    scenario: "following-auth-recovery",
  },
  {
    status: 422,
    method: "POST",
    path: /^\/api\/purchase-experience-media\//,
    scenario: "purchase-media-validation",
  },
  {
    status: 410,
    method: "POST",
    path: /^\/api\/purchase-experience-media\//,
    scenario: "purchase-media-validation",
  },
  {
    status: 404,
    method: "GET",
    path: /^\/api\/seller\/orders\/.*\/direct-refund$/,
    scenario: "direct-refund-empty",
  },
  {
    status: 404,
    method: "GET",
    path: /^\/api\/seller\/orders\/[^/]+\/fulfillment$/,
    scenario: "seller-fulfillment-empty",
  },
  {
    status: 404,
    method: "GET",
    path: /^\/api\/seller\/orders\/.*\/direct-refund$/,
    scenario: "direct-refund-recovery",
  },
  {
    status: 503,
    method: "POST",
    path: /^\/api\/seller\/orders\/.*\/direct-refund$/,
    scenario: "direct-refund-recovery",
  },
  {
    status: 404,
    method: "GET",
    path: /^\/api\/orders\/[^/]+$/,
    scenario: "order-privacy",
  },
  {
    status: 404,
    method: "GET",
    path: /^\/api\/orders\/[^/]+\/direct-refund$/,
    scenario: "order-related-empty",
  },
  {
    status: 401,
    method: "POST",
    path: /^\/api\/cart\/attach$/,
    scenario: "buyer-sign-in-required",
  },
  {
    status: 409,
    method: "DELETE",
    path: /^\/api\/cart\/items\/[^/]+$/,
    scenario: "guest-cart-lifecycle",
  },
  {
    status: 409,
    method: "POST",
    path: /^\/api\/orders$/,
    scenario: "guest-cart-lifecycle",
  },
  {
    status: 409,
    method: "GET",
    path: /^\/api\/checkout\/options$/,
    scenario: "guest-cart-lifecycle",
  },
  {
    status: 404,
    method: "GET",
    path: /^\/s\/[^/]+\/products\/[^/]+$/,
    scenario: "guest-cart-lifecycle",
  },
  {
    status: 409,
    method: "POST",
    path: /^\/api\/cart\/attach$/,
    scenario: "cart-resolution-required",
  },
] as const;

const expectedCandidateFailures = [
  { method: "GET", path: /^\/api\/store\/media\//, scenario: "media-fallback" },
  {
    method: "POST",
    path: /^\/api\/purchase-experiences$/,
    scenario: "purchase-submit-retry",
  },
  {
    method: "POST",
    path: /^\/api\/store\/seller\/products\/[^/]+\/images$/,
    scenario: "product-network-recovery",
  },
  {
    method: "POST",
    path: /^\/api\/store\/seller\/products\/[^/]+\/publications$/,
    scenario: "product-network-recovery",
  },
  {
    method: "POST",
    path: /^\/api\/store\/seller\/products\/[^/]+\/unpublication$/,
    scenario: "product-network-recovery",
  },
  {
    method: "PUT",
    path: /^\/api\/seller\/inventory$/,
    scenario: "inventory-ambiguous-result",
  },
] as const;

type CandidateObserver = ReturnType<typeof createCandidateObserver>;

export const test = base.extend<{
  candidateObserver: CandidateObserver;
  newCandidateContext: (options?: BrowserContextOptions) => Promise<BrowserContext>;
  releaseCandidateGuard: void;
}>({
  candidateObserver: async ({ browser }, use, testInfo) => {
    void browser;
    await use(createCandidateObserver(testInfo));
  },
  newCandidateContext: async ({ browser, candidateObserver }, use) => {
    await use(async (options) => {
      const context = await browser.newContext(options);
      candidateObserver.observeContext(context);
      return context;
    });
  },
  releaseCandidateGuard: [
    async ({ context, candidateObserver }, use, testInfo) => {
      if (process.env.SEVO_RELEASE_CANDIDATE !== "1") {
        await use();
        return;
      }

      candidateObserver.observeContext(context);

      await use();
      candidateObserver.recordMissingExpectations();
      const guard = candidateObserver.guard;
      await testInfo.attach("release-candidate-guard", {
        body: Buffer.from(JSON.stringify(guard)),
        contentType: "application/json",
      });
      if (Object.values(guard).some((errors) => errors.length > 0)) {
        throw new Error(`Unexpected browser activity: ${JSON.stringify(guard)}`);
      }
    },
    { auto: true },
  ],
});

function createCandidateObserver(testInfo: TestInfo) {
  const guard = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    networkErrors: [] as string[],
    externalRequests: [] as string[],
  };
  const consumedResponses = new Map<number, number>();
  const consumedFailures = new Map<number, number>();
  const observedContexts = new WeakSet<BrowserContext>();
  const observedPages = new WeakSet<Page>();

  const observePage = (page: Page) => {
    if (process.env.SEVO_RELEASE_CANDIDATE !== "1" || observedPages.has(page)) return;
    observedPages.add(page);
    const expectedConsoleAllowances = new Map<string, number>();
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      queueMicrotask(() => {
        if (!location || !consumeExpectedConsoleAllowance(expectedConsoleAllowances, location)) {
          guard.consoleErrors.push(
            location ? `console.error ${candidateRouteFamily(location)}` : "console.error",
          );
        }
      });
    });
    page.on("pageerror", (error) =>
      guard.pageErrors.push(
        `${candidateRouteFamily(page.url())} unhandled ${safeErrorName(error)}`,
      ),
    );
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "unknown";
      const pathname = new URL(request.url()).pathname;
      if (
        !requestFailureIsNavigationCancellation(request.isNavigationRequest(), reason) &&
        !candidateRequestFailureIsExpected(
          request.method(),
          pathname,
          testInfo.annotations,
          consumedFailures,
        )
      ) {
        guard.networkErrors.push(
          `${candidateRouteFamily(page.url())} ${request.method()} ${request.resourceType()} request failed ${candidateRouteFamily(pathname)} ${safeFailureKind(reason)}`,
        );
      }
    });
    page.on("response", (response) => {
      const request = response.request();
      const pathname = new URL(response.url()).pathname;
      const expected = candidateResponseIsExpected(
        response.status(),
        request.method(),
        pathname,
        testInfo.annotations,
        consumedResponses,
      );
      if (response.status() >= 400 && !expected) {
        guard.networkErrors.push(
          `${response.status()} ${request.method()} ${candidateRouteFamily(pathname)}`,
        );
      } else if (expected) {
        const url = response.url();
        expectedConsoleAllowances.set(
          url,
          (expectedConsoleAllowances.get(url) ?? 0) + 1,
        );
      }
    });
    page.on("request", (request) => {
      const hostname = new URL(request.url()).hostname;
      if (!["127.0.0.1", "localhost"].includes(hostname)) {
        guard.externalRequests.push(`${request.method()} external request`);
      }
    });
  };

  return {
    guard,
    observeContext(context: BrowserContext) {
      if (process.env.SEVO_RELEASE_CANDIDATE !== "1" || observedContexts.has(context)) {
        return;
      }
      observedContexts.add(context);
      for (const page of context.pages()) observePage(page);
      context.on("page", observePage);
    },
    recordMissingExpectations() {
      for (const missing of missingCandidateExpectations(
        testInfo.annotations,
        consumedResponses,
        consumedFailures,
      )) {
        guard.networkErrors.push(`missing expected ${missing}`);
      }
    },
  };
}

export function expectCandidateResponse(
  testInfo: { annotations: Array<{ type: string; description?: string }> },
  scenario: (typeof expectedCandidateResponses)[number]["scenario"],
) {
  testInfo.annotations.push({
    type: "release-expected-response",
    description: scenario,
  });
}

export function expectCandidateFailure(
  testInfo: { annotations: Array<{ type: string; description?: string }> },
  scenario: (typeof expectedCandidateFailures)[number]["scenario"],
) {
  testInfo.annotations.push({
    type: "release-expected-failure",
    description: scenario,
  });
}

export function candidateRequestFailureIsExpected(
  method: string,
  pathname: string,
  annotations: Array<{ type: string; description?: string }>,
  consumed?: Map<number, number>,
) {
  const index = expectedCandidateFailures.findIndex(
    (entry) =>
      annotationCount(annotations, "release-expected-failure", entry.scenario) > 0 &&
      entry.method === method &&
      entry.path.test(pathname),
  );
  if (index < 0) return false;
  const scenario = expectedCandidateFailures[index].scenario;
  return consumeAnnotatedExpectation(
    annotations,
    "release-expected-failure",
    scenario,
    index,
    consumed,
  );
}

export function candidateResponseIsExpected(
  status: number,
  method: string,
  pathname: string,
  annotations: Array<{ type: string; description?: string }>,
  consumed?: Map<number, number>,
) {
  const index = expectedCandidateResponses.findIndex(
    (entry) =>
      annotationCount(annotations, "release-expected-response", entry.scenario) > 0 &&
      entry.status === status &&
      entry.method === method &&
      entry.path.test(pathname),
  );
  if (index < 0) return false;
  const scenario = expectedCandidateResponses[index].scenario;
  return consumeAnnotatedExpectation(
    annotations,
    "release-expected-response",
    scenario,
    index,
    consumed,
  );
}

export function requestFailureIsNavigationCancellation(
  isNavigationRequest: boolean,
  reason: string,
) {
  return (
    isNavigationRequest &&
    /^(?:Load cancelled|NS_BINDING_ABORTED|net::ERR_ABORTED)$/.test(reason)
  );
}

function consumeAnnotatedExpectation(
  annotations: Array<{ type: string; description?: string }>,
  type: "release-expected-response" | "release-expected-failure",
  scenario: string,
  index: number,
  consumed?: Map<number, number>,
) {
  const allowance = annotationCount(annotations, type, scenario);
  if (allowance === 0) return false;
  if (!consumed) return true;
  const used = consumed.get(index) ?? 0;
  if (used >= allowance) return false;
  consumed.set(index, used + 1);
  return true;
}

function annotationCount(
  annotations: Array<{ type: string; description?: string }>,
  type: "release-expected-response" | "release-expected-failure",
  scenario: string,
) {
  return annotations.filter(
    (annotation) => annotation.type === type && annotation.description === scenario,
  ).length;
}

export function missingCandidateExpectations(
  annotations: Array<{ type: string; description?: string }>,
  consumedResponses: Map<number, number>,
  consumedFailures: Map<number, number>,
) {
  const missing: string[] = [];
  for (const [type, entries, consumed] of [
    ["release-expected-response", expectedCandidateResponses, consumedResponses],
    ["release-expected-failure", expectedCandidateFailures, consumedFailures],
  ] as const) {
    entries.forEach((entry, index) => {
      const expected = annotationCount(annotations, type, entry.scenario);
      const observed = consumed.get(index) ?? 0;
      for (let count = observed; count < expected; count += 1) {
        missing.push(`${type === "release-expected-response" ? "response" : "failure"} ${entry.scenario}`);
      }
    });
  }
  return missing;
}

export function consumeExpectedConsoleAllowance(
  allowances: Map<string, number>,
  url: string,
) {
  const remaining = allowances.get(url) ?? 0;
  if (remaining === 0) return false;
  if (remaining === 1) allowances.delete(url);
  else allowances.set(url, remaining - 1);
  return true;
}

export function candidateRouteFamily(urlOrPathname: string) {
  const pathname = urlOrPathname.startsWith("http")
    ? new URL(urlOrPathname).pathname
    : urlOrPathname;
  const routes = [
    [/^\/api\/auth\//, "auth"],
    [/^\/api\/cart\/attach$/, "cart-attach"],
    [/^\/api\/cart\/items\//, "cart-items"],
    [/^\/api\/cart\/resolve$/, "cart-resolve"],
    [/^\/api\/cart(?:\/|$)/, "cart"],
    [/^\/api\/orders(?:\/|$)/, "buyer-orders"],
    [/^\/api\/checkout(?:\/|$)/, "checkout"],
    [/^\/api\/addresses(?:\/|$)/, "addresses"],
    [/^\/api\/payment-attempts(?:\/|$)/, "payment-attempts"],
    [/^\/api\/seller\//, "seller"],
    [/^\/api\/store\/media\//, "store-media"],
    [/^\/api\/store\/seller\/store\/draft$/, "store-draft"],
    [/^\/api\/store\/seller\//, "seller-store"],
    [/^\/api\/store\/me\//, "store-me"],
    [/^\/api\/store\//, "store"],
    [/^\/api\/conversations(?:\/|$)/, "conversations"],
    [/^\/api\/platform\//, "platform"],
    [/^\/_next\//, "next-resource"],
    [/^\/fonts?\//, "font-resource"],
    [/^\/(?:favicon\.ico|manifest\.webmanifest)$/, "app-resource"],
    [/^\/s\/[^/]+\/products\/[^/]+$/, "product-page"],
    [/^\/login(?:\/|$)/, "login-page"],
    [/^\/cart(?:\/|$)/, "cart-page"],
    [/^\/account\/addresses(?:\/|$)/, "addresses-page"],
    [/^\/checkout(?:\/|$)/, "checkout-page"],
  ] as const;
  return routes.find(([pattern]) => pattern.test(pathname))?.[1] ?? "other";
}

function safeErrorName(error: Error) {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "Error";
}

function safeFailureKind(reason: string) {
  if (/timed?\s*out/i.test(reason)) return "timeout";
  if (/refused/i.test(reason)) return "refused";
  if (/reset/i.test(reason)) return "reset";
  return "other";
}

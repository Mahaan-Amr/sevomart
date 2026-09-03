import { test as base } from "@playwright/test";

export * from "@playwright/test";

const expectedCandidateResponses = [
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
] as const;

export const test = base.extend<{ releaseCandidateGuard: void }>({
  releaseCandidateGuard: [
    async ({ page }, use, testInfo) => {
      if (process.env.SEVO_RELEASE_CANDIDATE !== "1") {
        await use();
        return;
      }

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const networkErrors: string[] = [];
      const externalRequests: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push("console.error");
      });
      page.on("pageerror", () => pageErrors.push("unhandled page error"));
      page.on("requestfailed", (request) => {
        networkErrors.push(`${request.method()} request failed`);
      });
      page.on("response", (response) => {
        const request = response.request();
        const pathname = new URL(response.url()).pathname;
        const expected = expectedCandidateResponses.some(
          (entry) =>
            testInfo.annotations.some(
              (annotation) =>
                annotation.type === "release-expected-response" &&
                annotation.description === entry.scenario,
            ) &&
            entry.status === response.status() &&
            entry.method === request.method() &&
            entry.path.test(pathname),
        );
        if (response.status() >= 400 && !expected) {
          networkErrors.push(`${response.status()} ${request.method()}`);
        }
      });
      page.on("request", (request) => {
        const hostname = new URL(request.url()).hostname;
        if (!["127.0.0.1", "localhost"].includes(hostname)) {
          externalRequests.push(`${request.method()} external request`);
        }
      });

      await use();
      const guard = { consoleErrors, pageErrors, networkErrors, externalRequests };
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

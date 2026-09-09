import { describe, expect, it } from "vitest";

import {
  candidateRequestFailureIsExpected,
  candidateRequestIsExternal,
  candidateResponseIsExpected,
  candidateRouteFamily,
  consumeExpectedConsoleAllowance,
  missingCandidateExpectations,
  pageErrorIsWebKitLocalFetchCancellation,
  requestFailureIsNavigationCancellation,
} from "../helpers/release-playwright";

describe("release browser guard policy", () => {
  it("allows an intentional response only in its annotated scenario", () => {
    const response = [503, "PUT", "/api/store/me/follows/fixture"] as const;
    expect(candidateResponseIsExpected(...response, [])).toBe(false);
    expect(
      candidateResponseIsExpected(...response, [
        { type: "release-expected-response", description: "following-recovery" },
      ]),
    ).toBe(true);
    expect(
      candidateResponseIsExpected(500, response[1], response[2], [
        { type: "release-expected-response", description: "following-recovery" },
      ]),
    ).toBe(false);
  });

  it("recognizes only exact browser navigation cancellation reasons", () => {
    for (const reason of ["Load cancelled", "NS_BINDING_ABORTED", "net::ERR_ABORTED"]) {
      expect(requestFailureIsNavigationCancellation(true, reason)).toBe(true);
      expect(requestFailureIsNavigationCancellation(false, reason)).toBe(false);
    }
    expect(requestFailureIsNavigationCancellation(true, "connection reset")).toBe(
      false,
    );
    expect(
      requestFailureIsNavigationCancellation(true, "net::ERR_ABORTED_BY_EXTENSION"),
    ).toBe(false);
    expect(
      requestFailureIsNavigationCancellation(
        false,
        "net::ERR_ABORTED",
        "http://127.0.0.1:3110/?_rsc=route-transition",
      ),
    ).toBe(true);
    expect(
      requestFailureIsNavigationCancellation(
        false,
        "net::ERR_ABORTED",
        "http://127.0.0.1:3110/api/orders",
      ),
    ).toBe(false);
    expect(
      requestFailureIsNavigationCancellation(
        false,
        "Load request cancelled",
        "http://127.0.0.1:3110/_next/static/chunks/app.js",
      ),
    ).toBe(false);
    expect(
      requestFailureIsNavigationCancellation(
        false,
        "Load request cancelled",
        "http://127.0.0.1:3110/api/orders",
      ),
    ).toBe(false);
    expect(
      requestFailureIsNavigationCancellation(
        false,
        "Load request cancelled",
        "http://127.0.0.1:3110/cart?_rsc=fixture",
      ),
    ).toBe(true);
    expect(
      requestFailureIsNavigationCancellation(
        false,
        "Load failed",
        "http://127.0.0.1:3110/api/orders",
      ),
    ).toBe(false);
  });

  it("recognizes only WebKit local-fetch cancellation page errors", () => {
    expect(
      pageErrorIsWebKitLocalFetchCancellation(
        "webkit",
        "Fetch API cannot load http",
        "/127.0.0.1:3110/cart?_rsc=fixture due to access control checks.",
      ),
    ).toBe(true);
    expect(
      pageErrorIsWebKitLocalFetchCancellation(
        "webkit",
        "Fetch API cannot load http",
        "/localhost:3110/api/discovery due to access control checks.",
      ),
    ).toBe(false);
    expect(
      pageErrorIsWebKitLocalFetchCancellation(
        "chromium",
        "Fetch API cannot load http",
        "/127.0.0.1:3110/api/discovery due to access control checks.",
      ),
    ).toBe(false);
    expect(
      pageErrorIsWebKitLocalFetchCancellation(
        "webkit",
        "Fetch API cannot load https",
        "/example.com/private due to access control checks.",
      ),
    ).toBe(false);
  });

  it("allows local blob previews without allowing remote traffic", () => {
    expect(candidateRequestIsExternal("blob:http://127.0.0.1:3110/preview")).toBe(
      false,
    );
    expect(candidateRequestIsExternal("blob:http://localhost:3110/preview")).toBe(
      false,
    );
    expect(candidateRequestIsExternal("data:image/png;base64,fixture")).toBe(false);
    expect(candidateRequestIsExternal("https://cdn.example.com/image.png")).toBe(true);
  });

  it("consumes each annotated response allowance exactly once", () => {
    const annotations = [
      { type: "release-expected-response", description: "following-recovery" },
    ];
    const consumed = new Map<number, number>();
    const response = [503, "PUT", "/api/store/me/follows/fixture"] as const;

    expect(candidateResponseIsExpected(...response, annotations, consumed)).toBe(true);
    expect(candidateResponseIsExpected(...response, annotations, consumed)).toBe(false);
  });

  it("allows an intentional request failure only for its annotated method and route", () => {
    const annotations = [
      { type: "release-expected-failure", description: "media-fallback" },
    ];
    expect(
      candidateRequestFailureIsExpected("GET", "/api/store/media/fixture", annotations),
    ).toBe(true);
    expect(
      candidateRequestFailureIsExpected(
        "POST",
        "/api/store/media/fixture",
        annotations,
      ),
    ).toBe(false);
    expect(
      candidateRequestFailureIsExpected("GET", "/api/store/media/fixture", []),
    ).toBe(false);
  });

  it("consumes each annotated request-failure allowance exactly once", () => {
    const annotations = [
      { type: "release-expected-failure", description: "media-fallback" },
    ];
    const consumed = new Map<number, number>();

    expect(
      candidateRequestFailureIsExpected(
        "GET",
        "/api/store/media/fixture",
        annotations,
        consumed,
      ),
    ).toBe(true);
    expect(
      candidateRequestFailureIsExpected(
        "GET",
        "/api/store/media/fixture",
        annotations,
        consumed,
      ),
    ).toBe(false);
  });

  it("fails closed when an annotated event never occurs", () => {
    expect(
      missingCandidateExpectations(
        [{ type: "release-expected-response", description: "following-recovery" }],
        new Map(),
        new Map(),
      ),
    ).toEqual(["response following-recovery"]);
  });

  it("requires a separate annotation for every intentional guest-cart response", () => {
    const annotations = [
      { type: "release-expected-response", description: "guest-cart-delete-conflict" },
      { type: "release-expected-response", description: "guest-cart-order-conflict" },
      {
        type: "release-expected-response",
        description: "guest-cart-checkout-conflict",
      },
      { type: "release-expected-response", description: "guest-cart-product-missing" },
    ];
    const consumedResponses = new Map<number, number>();
    expect(
      candidateResponseIsExpected(
        409,
        "DELETE",
        "/api/cart/items/fixture",
        annotations,
        consumedResponses,
      ),
    ).toBe(true);
    expect(
      candidateResponseIsExpected(
        409,
        "POST",
        "/api/orders",
        annotations,
        consumedResponses,
      ),
    ).toBe(true);
    expect(
      candidateResponseIsExpected(
        409,
        "GET",
        "/api/checkout/options",
        annotations,
        consumedResponses,
      ),
    ).toBe(true);
    expect(
      candidateResponseIsExpected(
        404,
        "GET",
        "/s/store/products/product",
        annotations,
        consumedResponses,
      ),
    ).toBe(true);
    expect(
      missingCandidateExpectations(annotations, consumedResponses, new Map()),
    ).toEqual([]);
  });

  it("requires separate annotations for following authorization responses", () => {
    const annotations = [
      { type: "release-expected-response", description: "following-identity-inactive" },
      { type: "release-expected-response", description: "following-session-expired" },
    ];
    const consumedResponses = new Map<number, number>();
    expect(
      candidateResponseIsExpected(
        403,
        "GET",
        "/api/following",
        annotations,
        consumedResponses,
      ),
    ).toBe(true);
    expect(
      candidateResponseIsExpected(
        401,
        "GET",
        "/api/following",
        annotations,
        consumedResponses,
      ),
    ).toBe(true);
    expect(
      missingCandidateExpectations(annotations, consumedResponses, new Map()),
    ).toEqual([]);
  });

  it("consumes a console allowance for an expected response only once", () => {
    const allowances = new Map([["http://localhost/api/following", 1]]);
    expect(
      consumeExpectedConsoleAllowance(allowances, "http://localhost/api/following"),
    ).toBe(true);
    expect(
      consumeExpectedConsoleAllowance(allowances, "http://localhost/api/following"),
    ).toBe(false);
  });

  it("selects the annotated scenario when response tuples overlap", () => {
    expect(
      candidateResponseIsExpected(
        404,
        "GET",
        "/api/seller/orders/order-id/direct-refund",
        [{ type: "release-expected-response", description: "direct-refund-recovery" }],
      ),
    ).toBe(true);
  });

  it("reduces URLs to non-identifying route families", () => {
    expect(candidateRouteFamily("http://127.0.0.1/api/orders/private-id")).toBe(
      "buyer-orders",
    );
    expect(candidateRouteFamily("/_next/static/chunk.js")).toBe("next-resource");
    expect(candidateRouteFamily("/private/value")).toBe("other");
  });
});

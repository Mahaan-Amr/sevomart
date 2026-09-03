import { describe, expect, it } from "vitest";

import {
  candidateRequestFailureIsExpected,
  candidateResponseIsExpected,
  candidateRouteFamily,
  consumeExpectedConsoleAllowance,
  missingCandidateExpectations,
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
    expect(requestFailureIsNavigationCancellation(true, "connection reset")).toBe(false);
    expect(
      requestFailureIsNavigationCancellation(true, "net::ERR_ABORTED_BY_EXTENSION"),
    ).toBe(false);
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
      candidateRequestFailureIsExpected("POST", "/api/store/media/fixture", annotations),
    ).toBe(false);
    expect(candidateRequestFailureIsExpected("GET", "/api/store/media/fixture", [])).toBe(
      false,
    );
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

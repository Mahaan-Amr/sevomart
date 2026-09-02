import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type AlertRule = {
  alert?: string;
  expr?: string;
  for?: string;
  labels?: { severity?: string };
};

describe("MVP operational alerts", () => {
  it("connects payment, outbox failure and backlog rules to emitted metrics", () => {
    const document = parse(
      readFileSync("ops/alerts/mvp-operations.prometheus.yml", "utf8"),
    ) as { groups?: Array<{ rules?: AlertRule[] }> };
    const rules = document.groups?.flatMap((group) => group.rules ?? []) ?? [];
    const byName = new Map(rules.map((rule) => [rule.alert, rule]));

    expect(byName.get("SevoAmbiguousPaymentOverdue")).toMatchObject({
      expr: "sevo_payment_ambiguous_overdue > 0",
      for: "30s",
      labels: { severity: "critical" },
    });
    expect(byName.get("SevoExpiredPaymentHoldRecovered")?.expr).toContain(
      "sevo_payment_expired_holds_recovered_total",
    );
    expect(byName.get("SevoOutboxDeliveryFailure")?.expr).toContain(
      "sevo_outbox_delivery_failures_total",
    );
    expect(byName.get("SevoOutboxPoisonEvent")?.expr).toContain(
      "sevo_outbox_consumer_poison_events",
    );
    expect(byName.get("SevoOperationalBacklog")?.expr).toContain(
      "sevo_outbox_consumer_lag_milliseconds",
    );
    expect(rules).toHaveLength(5);

    const metricSources = [
      readFileSync("apps/worker/src/modules/payments/index.ts", "utf8"),
      readFileSync("packages/outbox/src/index.ts", "utf8"),
    ].join("\n");
    for (const metric of [
      "sevo.payment.ambiguous.overdue",
      "sevo.payment.expired_holds.recovered",
      "sevo.outbox.delivery.failures",
      "sevo.outbox.consumer.pending_events",
      "sevo.outbox.consumer.poison_events",
      "sevo.outbox.consumer.lag",
    ]) {
      expect(metricSources).toContain(metric);
    }
    expect(metricSources).not.toMatch(
      /(?:buyer|identity|order|event|correlation)_id\s*:/i,
    );
  });
});

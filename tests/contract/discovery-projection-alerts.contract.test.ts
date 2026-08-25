import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type AlertRule = {
  alert?: string;
  expr?: string;
  for?: string;
  labels?: { severity?: string };
};

describe("discovery projection operational alerts", () => {
  it("defines loadable critical rules for every projection failure signal", () => {
    const document = parse(
      readFileSync("ops/alerts/discovery-public-feed.prometheus.yml", "utf8"),
    ) as { groups?: Array<{ rules?: AlertRule[] }> };
    const rules = document.groups?.flatMap((group) => group.rules ?? []) ?? [];
    const byName = new Map(rules.map((rule) => [rule.alert, rule]));

    expect(byName.get("SevoDiscoveryProjectionUnhealthy")).toMatchObject({
      expr: "sevo_discovery_projection_healthy == 0",
      for: "30s",
      labels: { severity: "critical" },
    });
    expect(byName.get("SevoDiscoveryProjectionLagOutsideSlo")?.expr).toContain(
      "sevo_discovery_projection_lag_milliseconds > 60000",
    );
    expect(byName.get("SevoDiscoveryProjectionPoisonEvent")?.expr).toContain(
      "sevo_discovery_projection_poison_events > 0",
    );
    expect(byName.get("SevoDiscoveryProjectionUnresolvedBuffer")?.expr).toContain(
      "sevo_discovery_projection_unresolved_buffers > 0",
    );
    expect(byName.get("SevoDiscoveryProjectionRepeatedRebuildFailure")?.expr).toContain(
      'sevo_discovery_projection_rebuilds_total{outcome="failed"}[10m]',
    );
    expect(byName.get("SevoDiscoveryProjectionReplayActivity")?.expr).toContain(
      "increase(sevo_discovery_projection_replayed_events_total[10m]) > 0",
    );
    expect(byName.get("SevoDiscoveryProjectionReplayActivity")?.labels).toEqual({
      severity: "warning",
    });
    expect(rules).toHaveLength(6);
    expect(
      rules
        .filter((rule) => rule.alert !== "SevoDiscoveryProjectionReplayActivity")
        .every((rule) => rule.labels?.severity === "critical"),
    ).toBe(true);
  });
});

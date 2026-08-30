import { describe, expect, it, vi } from "vitest";

import { createQaScenarioFactory } from "../../scripts/qa/scenario-factory.v1.mjs";

const target = {
  databaseName: "sevo_qa_checkout_failure_a1b2c3d4e5f6",
  databasePort: 55432,
  fingerprint: "8e2cd400-e2d7-4ff8-b390-cb265d3eaf9b",
  minioPort: 59000,
  profile: "qa",
  projectName: "sevomart-qa-checkout-failure-a1b2c3d4e5f6",
  runId: "checkout-failure-a1b2c3d4e5f6",
};

describe("QA scenario factory v1", () => {
  it("builds only the requested scenario with a unique namespace and fixed clock", async () => {
    const lifecycle = {
      up: vi.fn(async () => target),
      down: vi.fn(async () => {}),
    };
    const factory = createQaScenarioFactory({
      lifecycle,
      randomId: () => "a1b2c3d4e5f6",
    });
    const build = vi.fn(async () => ({ identities: 1 }));

    const result = await factory.withScenario(
      {
        name: "checkout-failure",
        fixedTime: "2026-08-30T08:30:00.000Z",
        build,
      },
      async (scenario) => ({
        databaseName: scenario.database.name,
        firstNow: scenario.clock.now().toISOString(),
        identityId: scenario.id("buyer"),
        namespace: scenario.namespace,
        secondNow: scenario.clock.now().toISOString(),
        seedReport: scenario.data,
      }),
    );

    expect(lifecycle.up).toHaveBeenCalledExactlyOnceWith(target.runId);
    expect(build).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      databaseName: target.databaseName,
      firstNow: "2026-08-30T08:30:00.000Z",
      identityId: "8538d4ab-057c-5324-af22-f1a02ea64f4c",
      namespace: `sevo.qa.${target.runId}`,
      secondNow: "2026-08-30T08:30:00.000Z",
      seedReport: { identities: 1 },
    });
    expect(lifecycle.down).toHaveBeenCalledExactlyOnceWith({
      fingerprint: target.fingerprint,
      runId: target.runId,
    });
  });

  it("tears down only the owned run when scenario setup fails", async () => {
    const lifecycle = {
      up: vi.fn(async () => target),
      down: vi.fn(async () => {}),
    };
    const factory = createQaScenarioFactory({
      lifecycle,
      randomId: () => "a1b2c3d4e5f6",
    });
    const exercise = vi.fn();

    await expect(
      factory.withScenario(
        {
          name: "checkout-failure",
          fixedTime: "2026-08-30T08:30:00.000Z",
          build: async () => {
            throw new Error("scenario setup failed");
          },
        },
        exercise,
      ),
    ).rejects.toThrow("scenario setup failed");

    expect(exercise).not.toHaveBeenCalled();
    expect(lifecycle.down).toHaveBeenCalledExactlyOnceWith({
      fingerprint: target.fingerprint,
      runId: target.runId,
    });
  });

  it("attempts owner-scoped teardown when the lifecycle report is inconsistent", async () => {
    const lifecycle = {
      up: vi.fn(async () => ({ ...target, projectName: "unexpected-project" })),
      down: vi.fn(async () => {}),
    };
    const factory = createQaScenarioFactory({
      lifecycle,
      randomId: () => "a1b2c3d4e5f6",
    });

    await expect(
      factory.withScenario(
        {
          name: "checkout-failure",
          fixedTime: "2026-08-30T08:30:00.000Z",
          build: async () => ({}),
        },
        async () => {},
      ),
    ).rejects.toThrow("outside the requested run");

    expect(lifecycle.down).toHaveBeenCalledExactlyOnceWith({
      fingerprint: target.fingerprint,
      runId: target.runId,
    });
  });

  it("preserves both failures when scenario work and teardown fail", async () => {
    const scenarioFailure = new Error("scenario failed");
    const teardownFailure = new Error("teardown failed");
    const lifecycle = {
      up: vi.fn(async () => target),
      down: vi.fn(async () => {
        throw teardownFailure;
      }),
    };
    const factory = createQaScenarioFactory({
      lifecycle,
      randomId: () => "a1b2c3d4e5f6",
    });

    const failure = await factory
      .withScenario(
        {
          name: "checkout-failure",
          fixedTime: "2026-08-30T08:30:00.000Z",
          build: async () => ({}),
        },
        async () => {
          throw scenarioFailure;
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      scenarioFailure,
      teardownFailure,
    ]);
    expect((failure as AggregateError).cause).toBe(teardownFailure);
  });

  it("fails a successful scenario when teardown is not confirmed", async () => {
    const teardownFailure = new Error("teardown failed");
    const lifecycle = {
      up: vi.fn(async () => target),
      down: vi.fn(async () => {
        throw teardownFailure;
      }),
    };
    const factory = createQaScenarioFactory({
      lifecycle,
      randomId: () => "a1b2c3d4e5f6",
    });

    await expect(
      factory.withScenario(
        {
          name: "checkout-failure",
          fixedTime: "2026-08-30T08:30:00.000Z",
          build: async () => ({}),
        },
        async () => "passed",
      ),
    ).rejects.toBe(teardownFailure);
  });

  it.each([
    { name: "Demo Seed", fixedTime: "2026-08-30T08:30:00.000Z" },
    { name: "checkout", fixedTime: "2026-08-30" },
  ])(
    "rejects an invalid scenario contract before lifecycle write",
    async (definition) => {
      const lifecycle = {
        up: vi.fn(async () => target),
        down: vi.fn(async () => {}),
      };
      const factory = createQaScenarioFactory({
        lifecycle,
        randomId: () => "a1b2c3d4e5f6",
      });

      await expect(
        factory.withScenario(
          { ...definition, build: async () => ({}) },
          async () => {},
        ),
      ).rejects.toThrow();

      expect(lifecycle.up).not.toHaveBeenCalled();
      expect(lifecycle.down).not.toHaveBeenCalled();
    },
  );
});

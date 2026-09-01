import { describe, expect, it, vi } from "vitest";

import { createQaCommandRunner } from "../../scripts/qa/command-runner.mjs";

describe("QA command runner", () => {
  it("passes Docker arguments losslessly without a Windows shell", () => {
    const spawn = vi.fn(() => ({
      error: undefined,
      status: 0,
      stderr: "",
      stdout: "owner-token\n",
    }));
    const commands = createQaCommandRunner({
      environment: {},
      platform: "win32",
      spawn,
    });
    const template = '{{ index .Labels "sevo.qa.owner-token" }}';

    expect(
      commands.docker(["volume", "inspect", "--format", template, "qa-owner"], {
        capture: true,
      }),
    ).toBe("owner-token");
    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["volume", "inspect", "--format", template, "qa-owner"],
      expect.objectContaining({ shell: false }),
    );
  });
});

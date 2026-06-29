import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { normalizeCommandForCwd } from "../src/config";

describe("DAP adapter configuration", () => {
  it("resolves relative adapter commands from the debug cwd", () => {
    const cwd = "/workspace/project";
    const relative =
      process.platform === "win32" ? ".\\tools\\debug-adapter.cmd" : "./tools/debug-adapter";
    expect(normalizeCommandForCwd(relative, cwd)).toBe(
      path.resolve(cwd, process.platform === "win32" ? "tools/debug-adapter.cmd" : "tools/debug-adapter"),
    );
    expect(normalizeCommandForCwd("gdb -i dap", cwd)).toBe("gdb -i dap");
    expect(normalizeCommandForCwd("/usr/bin/lldb-dap", cwd)).toBe("/usr/bin/lldb-dap");
  });
});

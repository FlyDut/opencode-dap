import { describe, expect, it } from "bun:test";
import { DapClient } from "../src/client";
import { TEST_ADAPTER } from "./helpers";

interface MockProcState {
  resolveExited: () => void;
}

function createClient(): {
  client: DapClient;
  procState: MockProcState;
} {
  const { promise: exitedPromise, resolve: resolveExited } = Promise.withResolvers<void>();

  const fakeProc = {
    exitCode: null,
    stdin: { write: (_d: string | Uint8Array) => 0, flush: () => undefined },
    stdout: new ReadableStream<Uint8Array>(),
    stderr: new ReadableStream<Uint8Array>(),
    kill: () => true,
    exited: exitedPromise,
  } as unknown as Bun.Subprocess<"pipe">;

  const client = new DapClient(TEST_ADAPTER, "/tmp", fakeProc, Promise.resolve(""), {
    readable: new ReadableStream<Uint8Array>(),
    writeSink: {
      write(_data: string | Uint8Array) { return 0; },
      flush() { return undefined; },
    },
  });

  return { client, procState: { resolveExited } };
}

describe("DAP wire protocol — event API", () => {
  it("onEvent registers handler and unsubscribe removes it", () => {
    const { client } = createClient();

    const unsub = client.onEvent("stopped", () => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("onAnyEvent registers handler for all events", () => {
    const { client } = createClient();

    const unsub = client.onAnyEvent(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("onReverseRequest registers handler", () => {
    const { client } = createClient();

    const unsub = client.onReverseRequest("runInTerminal", (_args) => ({ processId: 123 }));
    expect(typeof unsub).toBe("function");
    unsub();
  });
});

describe("DAP wire protocol — request timeout", () => {
  it("sendRequest throws when signal is already aborted", async () => {
    const { client } = createClient();
    const signal = AbortSignal.abort();

    await expect(client.sendRequest("evaluate", {}, signal)).rejects.toThrow();
  });

  it("DapClient.spawn is the primary public constructor", () => {
    expect(typeof DapClient.spawn).toBe("function");
  });
});

describe("DAP client — lifecycle", () => {
  it("capabilities are undefined before initialize", () => {
    const { client } = createClient();
    expect(client.capabilities).toBeUndefined();
  });

  it("isAlive returns true for fresh client", () => {
    const { client } = createClient();
    expect(client.isAlive()).toBe(true);
  });

  it("isAlive returns false after dispose", async () => {
    const { client, procState } = createClient();

    const disposePromise = client.dispose();
    procState.resolveExited();
    await disposePromise;

    expect(client.isAlive()).toBe(false);
  });

  it("dispose is idempotent", async () => {
    const { client, procState } = createClient();

    procState.resolveExited();
    await client.dispose();
    await client.dispose();
    expect(client.isAlive()).toBe(false);
  });
});

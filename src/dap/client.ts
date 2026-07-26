import { stat } from "node:fs/promises";
import { NON_INTERACTIVE_ENV } from "../non-interactive-env.js";
import type {
  DapCapabilities,
  DapEventMessage,
  DapInitializeArguments,
  DapLaunchArguments,
  DapAttachArguments,
  DapPendingRequest,
  DapRequestMessage,
  DapResolvedAdapter,
  DapResponseMessage,
} from "./types";
import { warn, debug } from "./logger.js";

interface DapSpawnOptions {
  adapter: DapResolvedAdapter;
  cwd: string;
  socketReadyTimeoutMs?: number;
}

interface DapWriteSink {
  write(data: string | Uint8Array): number | Promise<number>;
  flush(): number | Promise<number> | undefined;
}

interface DapProc {
  exited: Promise<number>;
  exitCode: number | null;
  stdin: DapWriteSink;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(): void;
  peekStderr?(): string;
}

type DapEventHandler = (body: unknown, event: DapEventMessage) => void | Promise<void>;
type DapReverseRequestHandler = (args: unknown) => unknown | Promise<unknown>;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const WRITE_MESSAGE_TIMEOUT_MS = 30_000;
const SOCKET_READY_TIMEOUT_MS = 10_000;


function detachedCommand(cmd: string, args: string[]): [string, string[]] {
  if (process.platform === "linux" && Bun.which("setsid")) {
    return ["setsid", ["--wait", cmd, ...args]];
  }
  return [cmd, args];
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

const MESSAGE_DECODER = new TextDecoder("utf-8");

function findHeaderEndInChunks(chunks: Buffer[]): number {
  let global = 0;
  let b0 = -1;
  let b1 = -1;
  let b2 = -1;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const b3 = chunk[i]!;
      if (b0 === 13 && b1 === 10 && b2 === 13 && b3 === 10) {
        return global - 3;
      }
      b0 = b1;
      b1 = b2;
      b2 = b3;
      global++;
    }
  }
  return -1;
}

function copyChunkRange(chunks: Buffer[], from: number, to: number): Buffer {
  const out = Buffer.allocUnsafe(to - from);
  let global = 0;
  let written = 0;
  for (const chunk of chunks) {
    const chunkEnd = global + chunk.length;
    if (chunkEnd > from && global < to) {
      const start = Math.max(from, global) - global;
      const end = Math.min(to, chunkEnd) - global;
      chunk.copy(out, written, start, end);
      written += end - start;
    }
    global = chunkEnd;
    if (global >= to) break;
  }
  return out;
}

function dropChunkFront(chunks: Buffer[], count: number): void {
  let removed = 0;
  while (chunks.length > 0) {
    const head = chunks[0]!;
    if (removed + head.length <= count) {
      removed += head.length;
      chunks.shift();
    } else {
      chunks[0] = head.subarray(count - removed);
      break;
    }
  }
}

class MessageFramer {
  readonly #pendingChunks: Buffer[] = [];
  #pendingLen = 0;

  constructor(seed: Buffer) {
    if (seed.length > 0) {
      this.#pendingChunks.push(seed);
      this.#pendingLen = seed.length;
    }
  }

  push(chunk: Buffer): void {
    this.#pendingChunks.push(chunk);
    this.#pendingLen += chunk.length;
  }

  *drain(onResync: (headerText: string) => void): Generator<string> {
    while (true) {
      const headerEnd = findHeaderEndInChunks(this.#pendingChunks);
      if (headerEnd === -1) break;

      const headerText = MESSAGE_DECODER.decode(
        copyChunkRange(this.#pendingChunks, 0, headerEnd),
      );
      const contentLengthMatch = headerText.match(/Content-Length: (\d+)/i);
      if (!contentLengthMatch) {
        onResync(headerText);
        dropChunkFront(this.#pendingChunks, headerEnd + 4);
        this.#pendingLen -= headerEnd + 4;
        continue;
      }

      const contentLength = Number.parseInt(contentLengthMatch[1]!, 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.#pendingLen < messageEnd) break;

      const messageText = MESSAGE_DECODER.decode(
        copyChunkRange(this.#pendingChunks, messageStart, messageEnd),
      );
      dropChunkFront(this.#pendingChunks, messageEnd);
      this.#pendingLen -= messageEnd;
      yield messageText;
    }
  }

  remainder(): Buffer {
    return this.#pendingChunks.length === 0
      ? Buffer.alloc(0)
      : this.#pendingChunks.length === 1
        ? this.#pendingChunks[0]!
        : Buffer.concat(this.#pendingChunks, this.#pendingLen);
  }
}

async function isUnixSocketReady(socketPath: string): Promise<boolean> {
  try {
    return (await stat(socketPath)).isSocket();
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  proc: { exitCode: number | null },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    if (proc.exitCode !== null) {
      throw new Error("Adapter process exited before socket was ready");
    }
    await Bun.sleep(50);
  }
  throw new Error(`Socket not ready after ${timeoutMs}ms`);
}

interface SocketTransport {
  readable: ReadableStream<Uint8Array>;
  writeSink: DapWriteSink;
  socket: { end(): void };
}

function socketToSink(socket: Bun.Socket<undefined>): DapWriteSink {
  return {
    write(data: string | Uint8Array) {
      return socket.write(data);
    },
    flush() {
      socket.flush();
      return undefined;
    },
  };
}

async function connectTcpSocket(
  host: string,
  port: number,
  onClose?: () => void,
): Promise<SocketTransport> {
  const { promise, resolve, reject } = Promise.withResolvers<SocketTransport>();
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let opened = false;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  void Bun.connect({
    hostname: host,
    port,
    socket: {
      open(socket) {
        opened = true;
        resolve({
          readable,
          writeSink: socketToSink(socket),
          socket,
        });
      },
      data(_socket, data) {
        streamController.enqueue(new Uint8Array(data));
      },
      close() {
        onClose?.();
        if (!opened) {
          reject(new Error(`Connection to TCP port ${host}:${port} closed before opening`));
        }
        try {
          streamController.close();
        } catch {
          /* already closed */
        }
      },
      error(_socket, error) {
        onClose?.();
        if (!opened) {
          reject(error);
        }
        try {
          streamController.error(error);
        } catch {
          /* already closed */
        }
      },
    },
  }).catch((error) => {
    onClose?.();
    reject(error);
  });
  return promise;
}

async function waitForTcpTransport(
  host: string,
  port: number,
  timeoutMs: number,
  proc: { exitCode: number | null },
): Promise<SocketTransport> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Adapter process exited before TCP port ${host}:${port} was ready`);
    }
    try {
      return await connectTcpSocket(host, port);
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error(`TCP port ${host}:${port} was not ready after ${timeoutMs}ms`);
}

export async function waitForTcpServerListening(
  proc: { stdout: ReadableStream<Uint8Array>; exitCode: number | null },
  port: number,
  timeoutMs: number,
): Promise<void> {
  const ready = Promise.withResolvers<void>();
  const portText = String(port);
  void (async () => {
    try {
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of proc.stdout) {
        buffered += decoder.decode(chunk, { stream: true });
        if (buffered.includes(portText)) {
          ready.resolve();
        }
        if (buffered.length > 4096) {
          buffered = buffered.slice(-1024);
        }
      }
    } catch {
      /* stdout errored — the connect loop surfaces the real failure */
    }
    ready.resolve();
  })();
  await Promise.race([ready.promise, Bun.sleep(timeoutMs)]);
}

async function connectSocket(options: { unix: string }): Promise<SocketTransport> {
  const { promise, resolve, reject } = Promise.withResolvers<SocketTransport>();
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let opened = false;

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  Bun.connect({
    unix: options.unix,
    socket: {
      open(socket) {
        opened = true;
        resolve({
          readable,
          writeSink: socketToSink(socket),
          socket,
        });
      },
      data(_socket, data) {
        streamController.enqueue(new Uint8Array(data));
      },
      close() {
        if (!opened) {
          reject(new Error(`Unix socket ${options.unix} closed before opening`));
        }
        try {
          streamController.close();
        } catch {
          /* already closed */
        }
      },
      error(_socket, err) {
        if (!opened) {
          reject(err);
        }
        try {
          streamController.error(err);
        } catch {
          /* already closed */
        }
      },
    },
  }).catch((error) => {
    if (!opened) reject(error);
  });

  return promise;
}

function wrapBunSubprocess(proc: Bun.Subprocess): DapProc {
  const stderrChunks: string[] = [];
  const stderr = proc.stderr as ReadableStream<Uint8Array>;
  const stdout = proc.stdout as ReadableStream<Uint8Array>;

  void (async () => {
    try {
      const reader = stderr.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrChunks.push(
          new TextDecoder().decode(value, { stream: true }),
        );
      }
    } catch {
      /* best effort */
    }
  })();

  return {
    exited: proc.exited,
    get exitCode() {
      return proc.exitCode;
    },
    stdin: proc.stdin as unknown as DapWriteSink,
    stdout,
    stderr,
    peekStderr: () => stderrChunks.join(""),
    kill: () => proc.kill(),
  };
}

function wrapBunSocket(rawSocket: Bun.Socket<undefined>): SocketTransport {
  let streamController: ReadableStreamDefaultController<Uint8Array>;

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  rawSocket.reload({
    socket: {
      open() {},
      data(_socket, data) {
        streamController.enqueue(new Uint8Array(data));
      },
      close() {
        try {
          streamController.close();
        } catch {
          /* already closed */
        }
      },
      error(_socket, err) {
        try {
          streamController.error(err);
        } catch {
          /* already closed */
        }
      },
    },
  });

  return {
    readable,
    writeSink: socketToSink(rawSocket),
    socket: rawSocket,
  };
}

export class DapClient {
  readonly adapter: DapResolvedAdapter;
  readonly cwd: string;
  readonly proc: DapProc;
  readonly port?: number;
  readonly #readable: ReadableStream<Uint8Array>;
  readonly #writeSink: DapWriteSink;
  readonly #socket?: { end(): void };
  #requestSeq = 0;
  #pendingRequests = new Map<number, DapPendingRequest>();
  #messageBuffer: Buffer = Buffer.alloc(0);
  #isReading = false;
  #disposed = false;
  #lastActivity = Date.now();
  #capabilities?: DapCapabilities;
  #eventHandlers = new Map<string, Set<DapEventHandler>>();
  #anyEventHandlers = new Set<DapEventHandler>();
  #reverseRequestHandlers = new Map<string, DapReverseRequestHandler>();
  #adapterExited = false;
  #pendingWriteExitRejectors = new Set<() => void>();
  #eventWaiterRejectors = new Set<(error: Error) => void>();

  constructor(
    adapter: DapResolvedAdapter,
    cwd: string,
    proc: DapProc,
    options?: {
      readable?: ReadableStream<Uint8Array>;
      writeSink?: DapWriteSink;
      socket?: { end(): void };
      port?: number;
    },
  ) {
    this.adapter = adapter;
    this.cwd = cwd;
    this.proc = proc;
    this.#readable = options?.readable ?? proc.stdout;
    this.#writeSink = options?.writeSink ?? proc.stdin;
    this.#socket = options?.socket;
    this.port = options?.port;
    this.proc.exited.then(
      () => this.#rejectPendingWritesForExit(),
      () => this.#rejectPendingWritesForExit(),
    );
  }

  static async spawn({
    adapter,
    cwd,
    socketReadyTimeoutMs,
  }: DapSpawnOptions): Promise<DapClient> {
    if (adapter.connectMode === "socket") {
      return DapClient.#spawnSocket({ adapter, cwd, socketReadyTimeoutMs });
    }
    if (adapter.connectMode === "tcp") {
      return DapClient.#spawnTcp({ adapter, cwd, socketReadyTimeoutMs });
    }
    const env = {
      ...Bun.env,
      ...NON_INTERACTIVE_ENV,
      ...adapter.env,
    };
    const [resolvedCommand, resolvedArgs] = detachedCommand(
      adapter.resolvedCommand,
      adapter.args,
    );
    const raw = Bun.spawn([resolvedCommand, ...resolvedArgs], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const proc = wrapBunSubprocess(raw);
    const client = new DapClient(adapter, cwd, proc);
    proc.exited.then(() => {
      client.#handleProcessExit();
    });
    void client.#startMessageReader();
    return client;
  }

  static async connect({
    adapter,
    cwd,
    host,
    port,
  }: {
    adapter: DapResolvedAdapter;
    cwd: string;
    host: string;
    port: number;
  }): Promise<DapClient> {
    const exited = Promise.withResolvers<number>();
    const { readable, writeSink, socket } = await connectTcpSocket(
      host,
      port,
      () => exited.resolve(0),
    );
    const proc: DapProc = {
      exited: exited.promise,
      exitCode: null,
      stdin: { write: () => 0, flush: () => undefined },
      stdout: new ReadableStream<Uint8Array>(),
      stderr: new ReadableStream<Uint8Array>(),
      peekStderr: () => "",
      kill: () => {
        exited.resolve(0);
      },
    };
    const client = new DapClient(adapter, cwd, proc, {
      readable,
      writeSink,
      socket,
      port,
    });
    exited.promise.then(() => client.#handleProcessExit());
    void client.#startMessageReader();
    return client;
  }

  static async #spawnTcp({
    adapter,
    cwd,
    socketReadyTimeoutMs,
  }: DapSpawnOptions): Promise<DapClient> {
    const host = "127.0.0.1";
    const reservation = Bun.listen({
      hostname: host,
      port: 0,
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
    });
    const port = reservation.port;
    reservation.stop(true);
    const args = adapter.args.map((arg) =>
      arg.replaceAll("${port}", String(port)),
    );
    const [resolvedCommand, resolvedArgs] = detachedCommand(
      adapter.resolvedCommand,
      args,
    );
    const raw = Bun.spawn([resolvedCommand, ...resolvedArgs], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        ...NON_INTERACTIVE_ENV,
        ...adapter.env,
      },
    });
    const proc = wrapBunSubprocess(raw);

    try {
      const readyTimeoutMs = socketReadyTimeoutMs ?? SOCKET_READY_TIMEOUT_MS;
      await waitForTcpServerListening(proc, port, readyTimeoutMs);
      const { readable, writeSink, socket } = await waitForTcpTransport(
        host,
        port,
        readyTimeoutMs,
        proc,
      );
      const client = new DapClient(adapter, cwd, proc, {
        readable,
        writeSink,
        socket,
        port,
      });
      proc.exited.then(() => client.#handleProcessExit());
      void client.#startMessageReader();
      return client;
    } catch (error) {
      try {
        proc.kill();
      } catch {
        /* proc may already be dead */
      }
      throw error;
    }
  }

  static async #spawnSocket({
    adapter,
    cwd,
    socketReadyTimeoutMs,
  }: DapSpawnOptions): Promise<DapClient> {
    const env = {
      ...Bun.env,
      ...NON_INTERACTIVE_ENV,
      ...adapter.env,
    };
    const timeoutMs = socketReadyTimeoutMs ?? SOCKET_READY_TIMEOUT_MS;
    const isLinux = process.platform === "linux";

    if (isLinux) {
      return DapClient.#spawnSocketUnix({ adapter, cwd, env, timeoutMs });
    }
    return DapClient.#spawnSocketClientAddr({ adapter, cwd, env, timeoutMs });
  }

  static async #spawnSocketUnix({
    adapter,
    cwd,
    env,
    timeoutMs,
  }: {
    adapter: DapResolvedAdapter;
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
  }): Promise<DapClient> {
    const socketPath = `/tmp/dap-${adapter.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
    const [resolvedCommand, resolvedArgs] = detachedCommand(
      adapter.resolvedCommand,
      adapter.args,
    );
    const raw = Bun.spawn(
      [resolvedCommand, ...resolvedArgs, `--listen=unix:${socketPath}`],
      {
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      },
    );
    const proc = wrapBunSubprocess(raw);

    try {
      await waitForCondition(
        () => isUnixSocketReady(socketPath),
        timeoutMs,
        proc,
      );
      const { readable, writeSink, socket } = await connectSocket({
        unix: socketPath,
      });
      const client = new DapClient(adapter, cwd, proc, {
        readable,
        writeSink,
        socket,
      });
      proc.exited.then(() => client.#handleProcessExit());
      void client.#startMessageReader();
      return client;
    } catch (error) {
      try {
        proc.kill();
      } catch {
        /* proc may already be dead */
      }
      throw error;
    }
  }

  static async #spawnSocketClientAddr({
    adapter,
    cwd,
    env,
    timeoutMs,
  }: {
    adapter: DapResolvedAdapter;
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
  }): Promise<DapClient> {
    const { promise: connPromise, resolve: resolveConn } =
      Promise.withResolvers<Bun.Socket<undefined>>();

    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          resolveConn(socket);
        },
        data() {},
        close() {},
        error() {},
      },
    });

    const port = server.port;
    const [resolvedCommand, resolvedArgs] = detachedCommand(
      adapter.resolvedCommand,
      adapter.args,
    );
    const raw = Bun.spawn(
      [
        resolvedCommand,
        ...resolvedArgs,
        `--client-addr=127.0.0.1:${port}`,
      ],
      {
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env,
      },
    );
    const proc = wrapBunSubprocess(raw);

    const { promise: timeoutPromise, reject: rejectTimeout } =
      Promise.withResolvers<never>();
    const connectTimeout = setTimeout(
      () =>
        rejectTimeout(
          new Error(`${adapter.name} did not connect within ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
    try {
      const rawSocket = await Promise.race([connPromise, timeoutPromise]);
      const { readable, writeSink, socket } = wrapBunSocket(rawSocket);
      const client = new DapClient(adapter, cwd, proc, {
        readable,
        writeSink,
        socket,
      });
      proc.exited.then(() => client.#handleProcessExit());
      void client.#startMessageReader();
      return client;
    } catch (error) {
      try {
        proc.kill();
      } catch {
        /* proc may already be dead */
      }
      throw error;
    } finally {
      clearTimeout(connectTimeout);
      server.stop();
    }
  }

  get capabilities(): DapCapabilities | undefined {
    return this.#capabilities;
  }

  get lastActivity(): number {
    return this.#lastActivity;
  }

  isAlive(): boolean {
    return !this.#disposed && this.proc.exitCode === null;
  }

  async initialize(
    args: DapInitializeArguments,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<DapCapabilities> {
    const body = (await this.sendRequest(
      "initialize",
      args,
      signal,
      timeoutMs,
    )) as DapCapabilities | undefined;
    this.#capabilities = body ?? {};
    return this.#capabilities;
  }

  onEvent(event: string, handler: DapEventHandler): () => void {
    const handlers =
      this.#eventHandlers.get(event) ?? new Set<DapEventHandler>();
    handlers.add(handler);
    this.#eventHandlers.set(event, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.#eventHandlers.delete(event);
      }
    };
  }

  onAnyEvent(handler: DapEventHandler): () => void {
    this.#anyEventHandlers.add(handler);
    return () => {
      this.#anyEventHandlers.delete(handler);
    };
  }

  onReverseRequest(
    command: string,
    handler: DapReverseRequestHandler,
  ): () => void {
    this.#reverseRequestHandlers.set(command, handler);
    return () => {
      if (this.#reverseRequestHandlers.get(command) === handler) {
        this.#reverseRequestHandlers.delete(command);
      }
    };
  }

  async waitForEvent<TBody>(
    event: string,
    predicate?: (body: TBody) => boolean,
    signal?: AbortSignal,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<TBody> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
    }
    const { promise, resolve, reject } = Promise.withResolvers<TBody>();
    let timeout: Timer | undefined;
    const cleanup = () => {
      unsubscribe();
      this.#eventWaiterRejectors.delete(closeHandler);
      if (timeout) clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    };
    const abortHandler = () => {
      cleanup();
      reject(
        signal?.reason instanceof Error ? signal.reason : new Error("Aborted"),
      );
    };
    const closeHandler = (error: Error) => {
      cleanup();
      reject(error);
    };
    const unsubscribe = this.onEvent(event, (body) => {
      const typedBody = body as TBody;
      if (predicate && !predicate(typedBody)) {
        return;
      }
      cleanup();
      resolve(typedBody);
    });
    this.#eventWaiterRejectors.add(closeHandler);
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(`DAP event ${event} timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    return promise;
  }

  async sendRequest<TBody = unknown>(
    command: string,
    args?: unknown,
    signal?: AbortSignal,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<TBody> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
    }
    if (this.#disposed) {
      throw new Error(`DAP adapter ${this.adapter.name} is not running`);
    }
    const requestSeq = ++this.#requestSeq;
    const request: DapRequestMessage = {
      seq: requestSeq,
      type: "request",
      command,
      arguments: args,
    };
    const { promise, resolve, reject } = Promise.withResolvers<TBody>();
    promise.catch(() => {});

    let timeout: Timer | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    };
    const abortHandler = () => {
      this.#pendingRequests.delete(requestSeq);
      cleanup();
      reject(
        signal?.reason instanceof Error ? signal.reason : new Error("Aborted"),
      );
    };
    timeout = setTimeout(() => {
      if (!this.#pendingRequests.has(requestSeq)) return;
      this.#pendingRequests.delete(requestSeq);
      cleanup();
      reject(
        new Error(
          `DAP request ${command} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    this.#pendingRequests.set(requestSeq, {
      command,
      resolve: (body) => {
        cleanup();
        resolve(body as TBody);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });
    this.#lastActivity = Date.now();
    void this.#writeMessage(request).catch((error) => {
      if (!this.#pendingRequests.has(requestSeq)) return;
      this.#pendingRequests.delete(requestSeq);
      cleanup();
      reject(error);
    });
    return promise;
  }

  async sendResponse(
    request: DapRequestMessage,
    success: boolean,
    body?: unknown,
    message?: string,
  ): Promise<void> {
    const response: DapResponseMessage = {
      seq: ++this.#requestSeq,
      type: "response",
      request_seq: request.seq,
      success,
      command: request.command,
      ...(message ? { message } : {}),
      ...(body !== undefined ? { body } : {}),
    };
    await this.#writeMessage(response);
  }

  async #writeMessage(
    message: DapRequestMessage | DapResponseMessage,
  ): Promise<void> {
    const content = JSON.stringify(message);
    const writeResult1 = this.#writeSink.write(
      `Content-Length: ${Buffer.byteLength(content, "utf-8")}\r\n\r\n`,
    );
    const writeResult2 = this.#writeSink.write(content);

    if (writeResult1 instanceof Promise) await writeResult1;
    if (writeResult2 instanceof Promise) await writeResult2;

    const flushResult = this.#writeSink.flush();
    if (!(flushResult instanceof Promise)) return;

    if (this.#adapterExited) {
      throw new Error(
        `DAP adapter ${this.adapter.name} exited before write completed`,
      );
    }

    const {
      promise: guardPromise,
      reject: guardReject,
      resolve: guardResolve,
    } = Promise.withResolvers<void>();
    const timer = setTimeout(
      () =>
        guardReject(
          new Error(
            `DAP adapter ${this.adapter.name} write timed out after ${WRITE_MESSAGE_TIMEOUT_MS}ms`,
          ),
        ),
      WRITE_MESSAGE_TIMEOUT_MS,
    );
    const rejectOnExit = () => {
      guardReject(
        new Error(
          `DAP adapter ${this.adapter.name} exited before write completed`,
        ),
      );
    };
    this.#pendingWriteExitRejectors.add(rejectOnExit);

    try {
      await Promise.race([flushResult, guardPromise]);
    } catch (error) {
      void this.dispose();
      throw error;
    } finally {
      clearTimeout(timer);
      this.#pendingWriteExitRejectors.delete(rejectOnExit);
      guardResolve();
    }
  }

  #rejectPendingWritesForExit(): void {
    this.#adapterExited = true;
    for (const reject of this.#pendingWriteExitRejectors) {
      reject();
    }
    this.#pendingWriteExitRejectors.clear();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rejectPendingRequests(
      new Error(`DAP adapter ${this.adapter.name} disposed`),
    );
    try {
      this.#socket?.end();
    } catch {
      /* socket may already be closed */
    }
    try {
      this.proc.kill();
    } catch (error) {
      debug("Failed to kill DAP adapter", {
        adapter: this.adapter.name,
        error: toErrorMessage(error),
      });
    }
    await this.proc.exited.catch(() => {});
  }

  async #startMessageReader(): Promise<void> {
    if (this.#isReading) return;
    this.#isReading = true;
    const reader = this.#readable.getReader();

    const framer = new MessageFramer(this.#messageBuffer);

    let closeError: Error | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        framer.push(Buffer.from(value));

        for (const messageText of framer.drain((headerText) => {
          warn(
            "DAP framing resync: header block without Content-Length",
            {
              adapter: this.adapter.name,
              header: headerText.slice(0, 200),
            },
          );
        })) {
          this.#lastActivity = Date.now();

          try {
            const message = JSON.parse(messageText) as
              | DapResponseMessage
              | DapEventMessage
              | DapRequestMessage;
            if (message.type === "response") {
              this.#handleResponse(message);
            } else if (message.type === "event") {
              await this.#dispatchEvent(message);
            } else {
              await this.#handleAdapterRequest(message);
            }
          } catch (error) {
            warn("DAP message handling failed", {
              adapter: this.adapter.name,
              error: toErrorMessage(error),
            });
          }
        }
      }
    } catch (error) {
      closeError = new Error(
        `DAP connection closed: ${toErrorMessage(error)}`,
      );
    } finally {
      this.#messageBuffer = framer.remainder();
      reader.releaseLock();
      this.#isReading = false;
    }
    this.#failConnection(
      closeError ??
        new Error(
          `DAP connection closed: ${this.adapter.name} transport ended`,
        ),
    );
  }

  #handleResponse(message: DapResponseMessage): void {
    const pending = this.#pendingRequests.get(message.request_seq);
    if (!pending) {
      return;
    }
    this.#pendingRequests.delete(message.request_seq);
    if (message.success) {
      pending.resolve(message.body);
      return;
    }
    const errorMessage =
      message.message ?? `DAP request ${pending.command} failed`;
    pending.reject(new Error(errorMessage));
  }

  async #dispatchEvent(message: DapEventMessage): Promise<void> {
    const handlers = Array.from(
      this.#eventHandlers.get(message.event) ?? [],
    );
    const anyHandlers = Array.from(this.#anyEventHandlers);
    for (const handler of [...handlers, ...anyHandlers]) {
      try {
        await handler(message.body, message);
      } catch (error) {
        warn("DAP event handler failed", {
          adapter: this.adapter.name,
          event: message.event,
          error: toErrorMessage(error),
        });
      }
    }
  }

  async #handleAdapterRequest(message: DapRequestMessage): Promise<void> {
    try {
      const handler = this.#reverseRequestHandlers.get(message.command);
      if (handler) {
        try {
          const body = await handler(message.arguments);
          await this.sendResponse(message, true, body);
        } catch (error) {
          const errorMessage = toErrorMessage(error);
          await this.sendResponse(
            message,
            false,
            {
              error: {
                id: 1,
                format: errorMessage,
              },
            },
            errorMessage,
          );
        }
        return;
      }
      const errorMessage = `Unsupported DAP request: ${message.command}`;
      await this.sendResponse(
        message,
        false,
        {
          error: {
            id: 1,
            format: errorMessage,
          },
        },
        errorMessage,
      );
    } catch (error) {
      warn("Failed to answer DAP adapter request", {
        adapter: this.adapter.name,
        command: message.command,
        error: toErrorMessage(error),
      });
    }
  }

  #handleProcessExit(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try { this.#socket?.end(); } catch {}
    let stderr = "";
    try {
      if (typeof this.proc.peekStderr === "function") {
        stderr = this.proc.peekStderr().trim();
      }
    } catch {
      /* best effort */
    }
    const exitCode = this.proc.exitCode;
    const error = new Error(
      stderr
        ? `DAP adapter exited (code ${exitCode}): ${stderr}`
        : `DAP adapter exited unexpectedly (code ${exitCode})`,
    );
    this.#failConnection(error);
  }

  #failConnection(error: Error): void {
    this.#rejectPendingRequests(error);
    const waiters = Array.from(this.#eventWaiterRejectors);
    this.#eventWaiterRejectors.clear();
    for (const reject of waiters) {
      reject(error);
    }
  }

  #rejectPendingRequests(error: Error): void {
    for (const pending of this.#pendingRequests.values()) {
      pending.reject(error);
    }
    this.#pendingRequests.clear();
  }

  async launch(args: DapLaunchArguments): Promise<void> {
    await this.sendRequest("launch", args);
  }

  async attach(args: DapAttachArguments): Promise<void> {
    await this.sendRequest("attach", args);
  }
}

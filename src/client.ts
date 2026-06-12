import * as fs from "node:fs/promises";
import { NON_INTERACTIVE_ENV } from "./non-interactive-env";
import type {
	DapCapabilities,
	DapClientState,
	DapEventMessage,
	DapInitializeArguments,
	DapPendingRequest,
	DapRequestMessage,
	DapResolvedAdapter,
	DapResponseMessage,
} from "./types";

interface DapSpawnOptions {
	adapter: DapResolvedAdapter;
	cwd: string;
}

interface DapWriteSink {
	write(data: string | Uint8Array): number | Promise<number>;
	flush(): number | Promise<number> | undefined;
}

type DapEventHandler = (body: unknown, event: DapEventMessage) => void | Promise<void>;
type DapReverseRequestHandler = (args: unknown) => unknown | Promise<unknown>;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// Reused for all full decodes; each decode() resets state, so a single
// instance is safe and avoids per-message TextDecoder allocation.
const MESSAGE_DECODER = new TextDecoder("utf-8");


export class DapAbortError extends Error {
	constructor(message = "Operation aborted") {
		super(message);
		this.name = "DapAbortError";
	}
}


function isEnoent(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const nodeError = error as NodeJS.ErrnoException;
	return nodeError.code === "ENOENT";
}


function logError(context: string, detail: Record<string, unknown>): void {
	try {
		console.error(
			JSON.stringify({ service: "opencode-dap", level: "error", context, ...detail }),
		);
	} catch {
		// best-effort
	}
}

// ---------------------------------------------------------------------------
// Chunk-based byte-buffer helpers for the DAP framing reader
// ---------------------------------------------------------------------------


function findHeaderEndInChunks(chunks: Buffer[]): number {
	let global = 0;
	let b0 = -1;
	let b1 = -1;
	let b2 = -1;
	for (const chunk of chunks) {
		for (let i = 0; i < chunk.length; i++) {
			const b3 = chunk[i];
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
		const head = chunks[0];
		if (removed + head.length <= count) {
			removed += head.length;
			chunks.shift();
		} else {
			chunks[0] = head.subarray(count - removed);
			break;
		}
	}
}

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------


async function writeMessage(sink: DapWriteSink, message: DapRequestMessage | DapResponseMessage): Promise<void> {
	const content = JSON.stringify(message);
	sink.write(`Content-Length: ${Buffer.byteLength(content, "utf-8")}\r\n\r\n`);
	sink.write(content);
	await sink.flush();
}


function toErrorMessage(value: unknown): string {
	if (value instanceof Error) return value.message;
	return String(value);
}


interface SpawnedProc {
	proc: Bun.Subprocess<"pipe">;
	stderrAccumulator: Promise<string>;
}


async function spawnProc(command: string[], opts: { cwd: string; env: Record<string, string | undefined> }): Promise<SpawnedProc> {
	const proc = Bun.spawn(command, {
		cwd: opts.cwd,
		stdin: "pipe",
		stderr: "pipe",
		env: opts.env,
	});

	const readStderr = async (): Promise<string> => {
		let stderr = "";
		const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				stderr += new TextDecoder().decode(value);
			}
		} catch {
			// stream may close abruptly
		}
		return stderr;
	};

	return { proc, stderrAccumulator: readStderr() };
}

// ---------------------------------------------------------------------------
// DapClient
// ---------------------------------------------------------------------------


export class DapClient {
	readonly adapter: DapResolvedAdapter;
	readonly cwd: string;
	readonly proc: DapClientState["proc"];
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
	#getStderr: () => Promise<string>;

	constructor(
		adapter: DapResolvedAdapter,
		cwd: string,
		proc: Bun.Subprocess,
		stderrPromise: Promise<string>,
		options?: { readable?: ReadableStream<Uint8Array>; writeSink?: DapWriteSink; socket?: { end(): void } },
	) {
		this.adapter = adapter;
		this.cwd = cwd;
		this.proc = proc;
		this.#readable = options?.readable ?? (proc.stdout as ReadableStream<Uint8Array>);
		this.#writeSink = options?.writeSink ?? proc.stdin;
		this.#socket = options?.socket;
		let stderrResult = "";
		this.#getStderr = async () => {
			if (!stderrResult) stderrResult = await stderrPromise;
			return stderrResult;
		};
	}

	static async spawn({ adapter, cwd }: DapSpawnOptions): Promise<DapClient> {
		if (adapter.connectMode === "socket") {
			return DapClient.#spawnSocket({ adapter, cwd });
		}
		const env = {
			...Bun.env,
			...NON_INTERACTIVE_ENV,
		};
		const { proc, stderrAccumulator } = await spawnProc([adapter.resolvedCommand, ...adapter.args], {
			cwd,
			env,
		});
		const client = new DapClient(adapter, cwd, proc, stderrAccumulator);
		proc.exited.then(() => {
			client.#handleProcessExit();
		});
		void client.#startMessageReader();
		return client;
	}


	static async #spawnSocket({ adapter, cwd }: DapSpawnOptions): Promise<DapClient> {
		const env = {
			...Bun.env,
			...NON_INTERACTIVE_ENV,
		};
		const isLinux = process.platform === "linux";

		if (isLinux) {
			return DapClient.#spawnSocketUnix({ adapter, cwd, env });
		}
		return DapClient.#spawnSocketClientAddr({ adapter, cwd, env });
	}


	static async #spawnSocketUnix({
		adapter,
		cwd,
		env,
	}: {
		adapter: DapResolvedAdapter;
		cwd: string;
		env: Record<string, string | undefined>;
	}): Promise<DapClient> {
		const socketPath = `/tmp/dap-${adapter.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
		const { proc, stderrAccumulator } = await spawnProc([adapter.resolvedCommand, ...adapter.args, `--listen=unix:${socketPath}`], {
			cwd,
			env,
		});

		const waitForCondition = async (
			check: () => boolean | Promise<boolean>,
			timeoutMs: number,
			process: Bun.Subprocess,
		): Promise<void> => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				if (await check()) return;
				if (process.exitCode !== null) {
					throw new Error("Adapter process exited before socket was ready");
				}
				await Bun.sleep(50);
			}
			throw new Error(`Socket not ready after ${timeoutMs}ms`);
		};

		const isUnixSocketReady = async (path: string): Promise<boolean> => {
			try {
				return (await fs.stat(path)).isSocket();
			} catch (error) {
				if (isEnoent(error)) return false;
				throw error;
			}
		};

		await waitForCondition(() => isUnixSocketReady(socketPath), 10_000, proc);

		const { readable, writeSink, socket } = await connectSocket({ unix: socketPath });
		const client = new DapClient(adapter, cwd, proc, stderrAccumulator, { readable, writeSink, socket });
		proc.exited.then(() => client.#handleProcessExit());
		void client.#startMessageReader();
		return client;
	}


	static async #spawnSocketClientAddr({
		adapter,
		cwd,
		env,
	}: {
		adapter: DapResolvedAdapter;
		cwd: string;
		env: Record<string, string | undefined>;
	}): Promise<DapClient> {
		const { promise: connPromise, resolve: resolveConn } = Promise.withResolvers<Bun.Socket<undefined>>();

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
		const { proc, stderrAccumulator } = await spawnProc([adapter.resolvedCommand, ...adapter.args, `--client-addr=127.0.0.1:${port}`], {
			cwd,
			env,
		});

		let rawSocket: Bun.Socket<undefined>;
		const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
		const connectTimeout = setTimeout(
			() => rejectTimeout(new Error(`${adapter.name} did not connect within 10s`)),
			10_000,
		);
		try {
			rawSocket = await Promise.race([connPromise, timeoutPromise]);
		} finally {
			clearTimeout(connectTimeout);
			server.stop();
		}

		const { readable, writeSink, socket } = wrapBunSocket(rawSocket);
		const client = new DapClient(adapter, cwd, proc, stderrAccumulator, { readable, writeSink, socket });
		proc.exited.then(() => client.#handleProcessExit());
		void client.#startMessageReader();
		return client;
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	get capabilities(): DapCapabilities | undefined {
		return this.#capabilities;
	}

	get lastActivity(): number {
		return this.#lastActivity;
	}

	isAlive(): boolean {
		return !this.#disposed && this.proc.exitCode === null;
	}

	async initialize(args: DapInitializeArguments, signal?: AbortSignal, timeoutMs?: number): Promise<DapCapabilities> {
		const body = (await this.sendRequest("initialize", args, signal, timeoutMs)) as DapCapabilities | undefined;
		this.#capabilities = body ?? {};
		return this.#capabilities;
	}

	onEvent(event: string, handler: DapEventHandler): () => void {
		const handlers = this.#eventHandlers.get(event) ?? new Set<DapEventHandler>();
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

	onReverseRequest(command: string, handler: DapReverseRequestHandler): () => void {
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
			throw signal.reason instanceof Error ? signal.reason : new DapAbortError();
		}
		const { promise, resolve, reject } = Promise.withResolvers<TBody>();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			unsubscribe();
			if (timeout) clearTimeout(timeout);
			if (signal) {
				signal.removeEventListener("abort", abortHandler);
			}
		};
		const abortHandler = () => {
			cleanup();
			reject(signal?.reason instanceof Error ? signal.reason : new DapAbortError());
		};
		const unsubscribe = this.onEvent(event, body => {
			const typedBody = body as TBody;
			if (predicate && !predicate(typedBody)) {
				return;
			}
			cleanup();
			resolve(typedBody);
		});
		if (signal) {
			signal.addEventListener("abort", abortHandler, { once: true });
		}
		timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`DAP event ${event} timed out after ${timeoutMs}ms`));
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
			throw signal.reason instanceof Error ? signal.reason : new DapAbortError();
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
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			if (signal) {
				signal.removeEventListener("abort", abortHandler);
			}
		};
		const abortHandler = () => {
			this.#pendingRequests.delete(requestSeq);
			cleanup();
			reject(signal?.reason instanceof Error ? signal.reason : new DapAbortError());
		};
		timeout = setTimeout(() => {
			if (!this.#pendingRequests.has(requestSeq)) return;
			this.#pendingRequests.delete(requestSeq);
			cleanup();
			reject(new Error(`DAP request ${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		if (signal) {
			signal.addEventListener("abort", abortHandler, { once: true });
		}
		this.#pendingRequests.set(requestSeq, {
			command,
			resolve: body => {
				cleanup();
				resolve(body as TBody);
			},
			reject: error => {
				cleanup();
				reject(error);
			},
		});
		this.#lastActivity = Date.now();
		try {
			await writeMessage(this.#writeSink, request);
		} catch (error) {
			this.#pendingRequests.delete(requestSeq);
			cleanup();
			throw error;
		}
		return promise;
	}

	async sendResponse(request: DapRequestMessage, success: boolean, body?: unknown, message?: string): Promise<void> {
		const response: DapResponseMessage = {
			seq: ++this.#requestSeq,
			type: "response",
			request_seq: request.seq,
			success,
			command: request.command,
			...(message ? { message } : {}),
			...(body !== undefined ? { body } : {}),
		};
		await writeMessage(this.#writeSink, response);
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#rejectPendingRequests(new Error(`DAP adapter ${this.adapter.name} disposed`));
		try {
			this.#socket?.end();
		} catch {
			// socket may already be closed
		}
		try {
			this.proc.kill();
		} catch (error) {
			logError("Failed to kill DAP adapter", {
				adapter: this.adapter.name,
				error: toErrorMessage(error),
			});
		}
		await this.proc.exited.catch(() => {});
	}

	// -----------------------------------------------------------------------
	// Message reader
	// -----------------------------------------------------------------------

	async #startMessageReader(): Promise<void> {
		if (this.#isReading) return;
		this.#isReading = true;
		const reader = this.#readable.getReader();

		const pendingChunks: Buffer[] = [];
		let pendingLen = 0;
		if (this.#messageBuffer.length > 0) {
			pendingChunks.push(this.#messageBuffer);
			pendingLen = this.#messageBuffer.length;
		}

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				pendingChunks.push(Buffer.from(value));
				pendingLen += value.length;

				while (true) {
					const headerEnd = findHeaderEndInChunks(pendingChunks);
					if (headerEnd === -1) break;

					const headerText = MESSAGE_DECODER.decode(copyChunkRange(pendingChunks, 0, headerEnd));
					const contentLengthMatch = headerText.match(/Content-Length: (\d+)/i);
					if (!contentLengthMatch) {
						logError("DAP framing resync: header block without Content-Length", {
							adapter: this.adapter.name,
							header: headerText.slice(0, 200),
						});
						dropChunkFront(pendingChunks, headerEnd + 4);
						pendingLen -= headerEnd + 4;
						continue;
					}

					const contentLength = Number.parseInt(contentLengthMatch[1], 10);
					const messageStart = headerEnd + 4;
					const messageEnd = messageStart + contentLength;
					if (pendingLen < messageEnd) break;

					const messageText = MESSAGE_DECODER.decode(copyChunkRange(pendingChunks, messageStart, messageEnd));
					dropChunkFront(pendingChunks, messageEnd);
					pendingLen -= messageEnd;
					this.#lastActivity = Date.now();

					try {
						const message = JSON.parse(messageText) as DapResponseMessage | DapEventMessage | DapRequestMessage;
						if (message.type === "response") {
							this.#handleResponse(message);
						} else if (message.type === "event") {
							await this.#dispatchEvent(message);
						} else {
							await this.#handleAdapterRequest(message);
						}
					} catch (error) {
						logError("DAP message handling failed", {
							adapter: this.adapter.name,
							error: toErrorMessage(error),
						});
					}
				}
			}
		} catch (error) {
			this.#rejectPendingRequests(new Error(`DAP connection closed: ${toErrorMessage(error)}`));
		} finally {
			this.#messageBuffer =
				pendingChunks.length === 0
					? Buffer.alloc(0)
					: pendingChunks.length === 1
						? pendingChunks[0]
						: Buffer.concat(pendingChunks, pendingLen);
			reader.releaseLock();
			this.#isReading = false;
		}
	}

	// -----------------------------------------------------------------------
	// Dispatch
	// -----------------------------------------------------------------------

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
		const errorMessage = message.message ?? `DAP request ${pending.command} failed`;
		pending.reject(new Error(errorMessage));
	}

	async #dispatchEvent(message: DapEventMessage): Promise<void> {
		const handlers = Array.from(this.#eventHandlers.get(message.event) ?? []);
		const anyHandlers = Array.from(this.#anyEventHandlers);
		for (const handler of [...handlers, ...anyHandlers]) {
			try {
				await handler(message.body, message);
			} catch (error) {
				logError("DAP event handler failed", {
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
			logError("Failed to answer DAP adapter request", {
				adapter: this.adapter.name,
				command: message.command,
				error: toErrorMessage(error),
			});
		}
	}

	async #handleProcessExit(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		let stderr = "";
		try {
			stderr = (await this.#getStderr()).trim();
		} catch {
			// ignore
		}
		const exitCode = this.proc.exitCode;
		const error = new Error(
			stderr
				? `DAP adapter exited (code ${exitCode}): ${stderr}`
				: `DAP adapter exited unexpectedly (code ${exitCode})`,
		);
		this.#rejectPendingRequests(error);
	}

	#rejectPendingRequests(error: Error): void {
		for (const pending of this.#pendingRequests.values()) {
			pending.reject(error);
		}
		this.#pendingRequests.clear();
	}
}

// ---------------------------------------------------------------------------
// Socket transport helpers
// ---------------------------------------------------------------------------

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


async function connectSocket(options: { unix: string }): Promise<SocketTransport> {
	const { promise, resolve } = Promise.withResolvers<SocketTransport>();
	let streamController: ReadableStreamDefaultController<Uint8Array>;

	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			streamController = controller;
		},
	});

	Bun.connect({
		unix: options.unix,
		socket: {
			open(socket) {
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
				try {
					streamController.close();
				} catch {
					// already closed
				}
			},
			error(_socket, err) {
				try {
					streamController.error(err);
				} catch {
					// already closed
				}
			},
		},
	});

	return promise;
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
					// already closed
				}
			},
			error(_socket, err) {
				try {
					streamController.error(err);
				} catch {
					// already closed
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

import type { Plugin } from "@opencode-ai/plugin";
import { dapSessionManager } from "../shared/debug-session";

export const DebugLifecycle: Plugin = async () => {
	return {
		event: async ({ event }) => {
			if (event?.type === "session.idle" || event?.type === "session.deleted") {
				try {
					await dapSessionManager.terminate(undefined, 5_000);
				} catch {
					// best-effort cleanup
				}
			}
		},
	};
};

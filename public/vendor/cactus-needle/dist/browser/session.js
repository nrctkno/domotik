
import { NeedleError, validateInteger } from "../errors.js";
import { configuration } from "../runtime/configuration.js";
import { Agent } from "../client.js";
import { SpeechClient } from "../speech-client.js";
import { DEFAULT_MODEL, DEFAULT_SPEECH_MODEL } from "../runtime/artifacts.js";
import { RpcSession } from "../runtime/rpc-session.js";
import { readAudio } from "./audio.js";
//#region src/browser/session.ts
function resolveUrl(value, label) {
	try {
		const url = new URL(value, globalThis.location?.href);
		if (!["http:", "https:"].includes(url.protocol)) throw new Error("Expected an HTTP(S) URL.");
		return url.href;
	} catch (cause) {
		throw new NeedleError("INVALID_ARGUMENT", `${label} must be an HTTP(S) URL or page-relative path.`, { cause });
	}
}
/** Load a local browser session. Only setup fetches assets; inference stays in the worker. */
async function createNeedle(options = {}) {
	return new Agent((signal) => loadSession({
		...options,
		stateless: false,
		abortSignal: signal
	}, "needle3"), options).ready(options.abortSignal);
}
/** Load and cache Whistle separately from the text model. Reuse this session for each recording. */
async function createWhistle(options = {}) {
	return new SpeechClient((signal) => loadSession({
		...options,
		abortSignal: signal
	}, "whistle"), readAudio).ready(options.abortSignal);
}
async function loadSession(options, modelKind) {
	options.abortSignal?.throwIfAborted();
	const artifact = modelKind === "needle3" ? DEFAULT_MODEL : DEFAULT_SPEECH_MODEL;
	const shared = configuration(options);
	const tokens = validateInteger(options.maxOutputTokens ?? options.maxNewTokens ?? 512, "maxOutputTokens", 1, 65536);
	for (const key of ["cache", "offline"]) if (options[key] !== void 0 && typeof options[key] !== "boolean") throw new NeedleError("INVALID_ARGUMENT", `${key} must be a boolean.`);
	if (options.modelSha256 !== void 0 && !/^[a-f0-9]{64}$/i.test(options.modelSha256)) throw new NeedleError("INVALID_ARGUMENT", "modelSha256 must be a 64-character hex SHA-256 digest.");
	if (options.onDownloadProgress !== void 0 && typeof options.onDownloadProgress !== "function") throw new NeedleError("INVALID_ARGUMENT", "onDownloadProgress must be a function.");
	const input = options.model ?? artifact.url;
	const model = typeof input === "string" || input instanceof URL ? resolveUrl(input, "model") : input instanceof ArrayBuffer ? new Uint8Array(input.slice(0)) : input instanceof Uint8Array ? new Uint8Array(input) : void 0;
	if (model === void 0) throw new NeedleError("INVALID_ARGUMENT", "model must be a URL, ArrayBuffer, or Uint8Array.");
	const pinned = model === artifact.url;
	if (pinned && options.modelSha256 !== void 0 && options.modelSha256.toLowerCase() !== artifact.sha256) throw new NeedleError("INVALID_ARGUMENT", "The default model checksum cannot be overridden.");
	const config = {
		...shared,
		modelKind,
		model,
		wasmUrl: options.wasmUrl === void 0 ? new URL("../../vendor/needle.wasm", import.meta.url).href : resolveUrl(options.wasmUrl, "wasmUrl"),
		cache: options.cache ?? true,
		offline: options.offline ?? false,
		...pinned ? {
			modelSha256: artifact.sha256,
			modelSize: artifact.size
		} : options.modelSha256 ? { modelSha256: options.modelSha256.toLowerCase() } : {}
	};
	if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") throw new NeedleError("UNSUPPORTED_ENVIRONMENT", "Use the browser entry in a browser with WebAssembly and module workers. For Node.js, import cactus-needle.");
	if (!globalThis.crypto?.subtle) throw new NeedleError("UNSUPPORTED_ENVIRONMENT", "Browser inference requires HTTPS or localhost for integrity verification.");
	let worker;
	try {
		worker = options.workerUrl === void 0 ? new Worker(new URL("./worker.js", import.meta.url), {
			type: "module",
			name: "cactus-needle"
		}) : new Worker(resolveUrl(options.workerUrl, "workerUrl"), {
			type: "module",
			name: "cactus-needle"
		});
	} catch (cause) {
		throw new NeedleError("WORKER_ERROR", "Cannot start the inference worker. Check workerUrl and your worker-src Content Security Policy.", { cause });
	}
	const session = new RpcSession({
		send: (request) => worker.postMessage(request),
		terminate: async () => {
			worker.terminate();
		},
		listen(onMessage, onError) {
			worker.onmessage = ({ data }) => {
				if (data.type === "progress") try {
					options.onDownloadProgress?.(data.progress);
				} catch (error) {
					onError(error instanceof Error ? error : new Error(String(error)));
				}
				else onMessage(data);
			};
			worker.onerror = (event) => {
				event.preventDefault();
				onError(new Error(event.message || "Could not load worker."));
			};
			worker.onmessageerror = () => onError(/* @__PURE__ */ new Error("Could not decode a worker message."));
		}
	}, tokens);
	const abort = () => {
		session.close();
	};
	options.abortSignal?.addEventListener("abort", abort, { once: true });
	try {
		worker.postMessage({
			type: "init",
			config
		}, model instanceof Uint8Array ? [model.buffer] : []);
		await session.ready;
		options.abortSignal?.throwIfAborted();
		return session;
	} catch (error) {
		await session.close();
		if (options.abortSignal?.aborted) throw options.abortSignal.reason;
		throw error;
	} finally {
		options.abortSignal?.removeEventListener("abort", abort);
	}
}
//#endregion
export { createNeedle, createWhistle, loadSession };

//# sourceMappingURL=session.js.map
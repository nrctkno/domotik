
import { NeedleError, errorMessage, validateInteger, validateText } from "../errors.js";
import { serializeTools } from "./configuration.js";
import { transcriptionSettings } from "./audio.js";
//#region src/runtime/rpc-session.ts
/** Owns ordering, errors and disposal; transports contain platform-specific worker operations. */
var RpcSession = class {
	transport;
	maxNewTokens;
	ready;
	#pending = /* @__PURE__ */ new Map();
	#rejectReady;
	#nextId = 0;
	#closed = false;
	#closing;
	constructor(transport, maxNewTokens) {
		this.transport = transport;
		this.maxNewTokens = maxNewTokens;
		this.ready = new Promise((resolveReady, rejectReady) => {
			this.#rejectReady = rejectReady;
			transport.listen((message) => {
				if (this.#closed) return;
				if (message.type === "ready") resolveReady();
				else if (message.type === "error" && message.id === void 0) this.#fail(new NeedleError(message.code, message.message));
				else if ("id" in message && message.id !== void 0) {
					const pending = this.#pending.get(message.id);
					this.#pending.delete(message.id);
					if (message.type === "error") pending?.reject(new NeedleError(message.code, message.message));
					else if (message.type === "result") pending?.resolve(message.value);
				}
				if (!this.#closed && this.#pending.size === 0) transport.unref?.();
			}, (cause) => {
				if (!this.#closed) this.#fail(new NeedleError("WORKER_ERROR", `Inference worker failed: ${cause.message}`, { cause }));
			});
		});
	}
	#fail(error) {
		this.#closed = true;
		this.#rejectReady(error);
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
		this.transport.ref?.();
		this.#closing ??= this.transport.terminate();
		return this.#closing;
	}
	async #request(command, signal) {
		signal?.throwIfAborted();
		if (this.#closed) throw new NeedleError("CLOSED", "This model session is closed.");
		const abort = () => {
			this.close();
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const result = await new Promise((resolveResult, reject) => {
				const id = this.#nextId++;
				this.#pending.set(id, {
					resolve: resolveResult,
					reject
				});
				this.transport.ref?.();
				try {
					this.transport.send({
						...command,
						id
					});
				} catch (cause) {
					this.#fail(new NeedleError("WORKER_ERROR", errorMessage(cause), { cause }));
				}
			});
			signal?.throwIfAborted();
			return result;
		} catch (error) {
			if (signal?.aborted) throw signal.reason;
			throw error;
		} finally {
			signal?.removeEventListener("abort", abort);
		}
	}
	async generate({ prompt, tools, maxOutputTokens, abortSignal }) {
		abortSignal?.throwIfAborted();
		const raw = await this.complete(prompt, {
			...tools === void 0 ? {} : { tools },
			...maxOutputTokens === void 0 ? {} : { maxNewTokens: maxOutputTokens },
			...abortSignal === void 0 ? {} : { abortSignal }
		});
		abortSignal?.throwIfAborted();
		if (!raw.success) throw new NeedleError("ENGINE_ERROR", raw.error ?? "Generation failed.");
		const convert = (calls) => calls.map((call) => ({
			toolName: call.name,
			input: call.arguments
		}));
		return {
			toolCalls: convert(raw.function_calls),
			suppressedToolCalls: convert(raw.suppressed_calls),
			confidence: raw.confidence,
			reasoning: raw.reasoning,
			raw
		};
	}
	async complete(input = "", options = {}) {
		options.abortSignal?.throwIfAborted();
		validateText(input, "input");
		const maxNewTokens = validateInteger(options.maxNewTokens ?? this.maxNewTokens, "maxNewTokens", 1, 65536);
		return await this.#request({
			method: "complete",
			input,
			maxNewTokens,
			...options.tools === void 0 ? {} : { toolsJson: serializeTools(options.tools) }
		}, options.abortSignal);
	}
	async embed(input = "", options = {}) {
		options.abortSignal?.throwIfAborted();
		validateText(input, "input");
		return await this.#request({
			method: "embed",
			input
		}, options.abortSignal);
	}
	async transcribe(audio, { abortSignal, ...options } = {}) {
		abortSignal?.throwIfAborted();
		const settings = transcriptionSettings(options);
		return await this.#request({
			method: "transcribe",
			audio,
			settings
		}, abortSignal);
	}
	async embedAudio(audio) {
		return await this.#request({
			method: "embedAudio",
			audio
		});
	}
	async streamTranscribe(audio, settings) {
		return await this.#request({
			method: "streamTranscribe",
			audio,
			settings
		});
	}
	async reset() {
		await this.#request({ method: "reset" });
	}
	close() {
		return this.#closing ?? this.#fail(new NeedleError("CLOSED", "This Needle instance was closed."));
	}
	[Symbol.asyncDispose]() {
		return this.close();
	}
};
//#endregion
export { RpcSession };

//# sourceMappingURL=rpc-session.js.map

import { NeedleError } from "../errors.js";
//#region src/runtime/resident.ts
/** Owns lazy loading and serializes whole operations, including multi-step tool runs. */
var Resident = class {
	load;
	#lifetime = new AbortController();
	#session;
	#tail = Promise.resolve();
	#closing;
	constructor(load) {
		this.load = load;
	}
	assertOpen() {
		this.#lifetime.signal.throwIfAborted();
	}
	use(run, signal) {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (this.#lifetime.signal.aborted) return Promise.reject(this.#lifetime.signal.reason);
		const cancel = () => {
			this.close();
		};
		signal?.addEventListener("abort", cancel, { once: true });
		const stopped = this.#lifetime.signal;
		let rejectClosed;
		const closed = new Promise((_resolve, reject) => {
			rejectClosed = reject;
		});
		const onClose = () => rejectClosed(signal?.aborted ? signal.reason : stopped.reason);
		stopped.addEventListener("abort", onClose, { once: true });
		const operation = this.#tail.then(async () => {
			stopped.throwIfAborted();
			if (!this.#session) this.#session = this.load(stopped).catch((error) => {
				this.#session = void 0;
				throw error;
			});
			const session = await this.#session;
			stopped.throwIfAborted();
			const result = await run(session, stopped);
			stopped.throwIfAborted();
			return result;
		});
		this.#tail = operation.catch(() => {});
		return Promise.race([operation, closed]).finally(() => {
			signal?.removeEventListener("abort", cancel);
			stopped.removeEventListener("abort", onClose);
		});
	}
	/** Eager factories return a ready model or dispose of a failed initialization. */
	async ready(signal) {
		try {
			await this.use(async () => {}, signal);
			return this;
		} catch (error) {
			await this.close();
			throw error;
		}
	}
	close() {
		if (!this.#closing) {
			this.#lifetime.abort(new NeedleError("CLOSED", "This model session was closed."));
			this.#closing = this.#session?.then((session) => session.close(), () => {}) ?? Promise.resolve();
		}
		return this.#closing;
	}
	[Symbol.asyncDispose]() {
		return this.close();
	}
};
//#endregion
export { Resident };

//# sourceMappingURL=resident.js.map
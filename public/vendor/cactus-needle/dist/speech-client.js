
import { NeedleError } from "./errors.js";
import { Resident } from "./runtime/resident.js";
import { transcriptionSettings } from "./runtime/audio.js";
//#region src/speech-client.ts
var SpeechClient = class extends Resident {
	read;
	#stream;
	constructor(load, read) {
		super(load);
		this.read = read;
	}
	async transcribe(audio, options = {}) {
		options.abortSignal?.throwIfAborted();
		this.#available();
		const settings = transcriptionSettings(options);
		return this.use(async (session, signal) => {
			const input = await this.read(audio, signal);
			signal.throwIfAborted();
			return session.transcribe(input, settings);
		}, options.abortSignal);
	}
	async embed(audio, options = {}) {
		options.abortSignal?.throwIfAborted();
		this.#available();
		return this.use(async (session, signal) => {
			const input = await this.read(audio, signal);
			signal.throwIfAborted();
			return session.embedAudio(input);
		}, options.abortSignal);
	}
	#available() {
		this.assertOpen();
		if (this.#stream) throw new NeedleError("INVALID_ARGUMENT", "Finish or close the active transcription stream first.");
	}
	async *stream(chunks, options = {}) {
		options.abortSignal?.throwIfAborted();
		this.#available();
		const settings = transcriptionSettings(options);
		const controller = new AbortController();
		this.#stream = controller;
		const signal = options.abortSignal ? AbortSignal.any([controller.signal, options.abortSignal]) : controller.signal;
		const abort = () => {
			this.close();
		};
		options.abortSignal?.addEventListener("abort", abort, { once: true });
		let rejectCancelled;
		const cancelled = new Promise((_resolve, reject) => {
			rejectCancelled = reject;
		});
		cancelled.catch(() => {});
		const onCancel = () => rejectCancelled(options.abortSignal?.aborted ? options.abortSignal.reason : signal.reason);
		signal.addEventListener("abort", onCancel, { once: true });
		let iterator;
		let started = false;
		let finished = false;
		try {
			iterator = Symbol.asyncIterator in chunks ? chunks[Symbol.asyncIterator]() : chunks[Symbol.iterator]();
			while (true) {
				signal.throwIfAborted();
				const next = await Promise.race([iterator.next(), cancelled]);
				if (next.done) break;
				started = true;
				yield await this.use((session) => session.streamTranscribe(next.value, settings), signal);
			}
			if (started) {
				const tail = await this.use((session) => session.streamTranscribe(void 0, settings), signal);
				finished = true;
				yield tail;
			}
		} finally {
			options.abortSignal?.removeEventListener("abort", abort);
			signal.removeEventListener("abort", onCancel);
			if (started && !finished && !signal.aborted) try {
				await this.use((session) => session.streamTranscribe(void 0, settings));
			} catch {
				await this.close();
			}
			this.#stream = void 0;
			if (iterator?.return) {
				const cleanup = Promise.resolve().then(() => iterator?.return?.());
				if (signal.aborted) cleanup.catch(() => {});
				else await cleanup;
			}
		}
	}
	close() {
		this.#stream?.abort(new NeedleError("CLOSED", "This transcription stream was closed."));
		return super.close();
	}
};
//#endregion
export { SpeechClient };

//# sourceMappingURL=speech-client.js.map
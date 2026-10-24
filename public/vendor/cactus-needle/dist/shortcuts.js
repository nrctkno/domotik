
import { NeedleError } from "./errors.js";
//#region src/shortcuts.ts
/** Keeps one default model and scopes models with custom loading settings to a single operation. */
var DefaultModel = class {
	create;
	#model;
	constructor(create) {
		this.create = create;
	}
	#acquire(options, signal) {
		signal?.throwIfAborted();
		const custom = Object.values(options).some((value) => value !== void 0);
		const model = custom ? this.create(options) : this.#model ?? this.create();
		if (!custom) this.#model = model;
		return {
			model,
			release: async (error) => {
				const closed = signal?.aborted || error instanceof NeedleError && (error.code === "CLOSED" || error.code === "WORKER_ERROR");
				if (custom) await model.close();
				else if (closed && this.#model === model) {
					this.#model = void 0;
					await model.close();
				}
			}
		};
	}
	async use(options, signal, run) {
		const { model, release } = this.#acquire(options, signal);
		let failure;
		try {
			return await run(model);
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			await release(failure);
		}
	}
	async *stream(options, signal, run) {
		const { model, release } = this.#acquire(options, signal);
		let failure;
		try {
			yield* run(model);
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			await release(failure);
		}
	}
	async close() {
		const model = this.#model;
		this.#model = void 0;
		await model?.close();
	}
};
/** Python-style helpers retain the default models; custom settings use a scoped session. */
function shortcuts(textModel, speechModel) {
	const text = new DefaultModel(textModel);
	const speech = new DefaultModel(speechModel);
	return {
		stream(chunks, options) {
			const { language, keywords, abortSignal, ...loading } = options ?? {};
			return speech.stream(loading, abortSignal, (model) => model.stream(chunks, {
				...language === void 0 ? {} : { language },
				...keywords === void 0 ? {} : { keywords },
				...abortSignal === void 0 ? {} : { abortSignal }
			}));
		},
		async transcribe(audio, options) {
			const { language, keywords, wordTimestamps, abortSignal, ...loading } = options ?? {};
			return speech.use(loading, abortSignal, (model) => model.transcribe(audio, {
				...language === void 0 ? {} : { language },
				...keywords === void 0 ? {} : { keywords },
				...wordTimestamps === void 0 ? {} : { wordTimestamps },
				...abortSignal === void 0 ? {} : { abortSignal }
			}));
		},
		async extract(input, schema, options) {
			const { strict, maxNewTokens, abortSignal, ...loading } = options ?? {};
			return text.use(loading, abortSignal, (model) => model.extract(input, schema, {
				...strict === void 0 ? {} : { strict },
				...maxNewTokens === void 0 ? {} : { maxNewTokens },
				...abortSignal === void 0 ? {} : { abortSignal }
			}));
		},
		async close() {
			await Promise.all([text.close(), speech.close()]);
		}
	};
}
//#endregion
export { shortcuts };

//# sourceMappingURL=shortcuts.js.map

import { ExtractionValidationError, NeedleError, errorMessage, validateInteger, validateText } from "./errors.js";
import { tool, validateToolInput } from "./tools.js";
import { configuration } from "./runtime/configuration.js";
import { Resident } from "./runtime/resident.js";
//#region src/client.ts
function strictOption(strict) {
	if (strict !== void 0 && typeof strict !== "boolean") throw new NeedleError("INVALID_ARGUMENT", "strict must be a boolean.");
	return strict ?? true;
}
function checkSuccess(result) {
	if (!result.success) throw new NeedleError("ENGINE_ERROR", result.error ?? "Generation failed.");
}
var Agent = class extends Resident {
	options;
	constructor(load, options) {
		super(load);
		this.options = options;
		configuration(options);
	}
	generate(options) {
		return this.use(async (session) => {
			if (this.options.stateless) await session.reset();
			return session.generate(options);
		}, options.abortSignal);
	}
	complete(input = "", options) {
		return this.use(async (session) => {
			if (this.options.stateless) await session.reset();
			return session.complete(input, options);
		}, options?.abortSignal);
	}
	embed(input = "", options) {
		return this.use((session) => session.embed(input), options?.abortSignal);
	}
	reset() {
		return this.use((session) => session.reset());
	}
	async run(query = "", options = {}) {
		validateText(query, "query");
		const maxSteps = validateInteger(options.maxSteps ?? 8, "maxSteps", 1, 32);
		const strict = strictOption(options.strict);
		const completion = options.maxNewTokens === void 0 ? {} : { maxNewTokens: options.maxNewTokens };
		return this.use(async (session, signal) => {
			if (this.options.stateless) await session.reset();
			let response = await session.complete(query, completion);
			const executed = [];
			for (let step = 0; step < maxSteps; step++) {
				checkSuccess(response);
				if (response.type !== "call" || !response.function_calls.length) break;
				const results = [];
				for (const call of response.function_calls) {
					signal.throwIfAborted();
					const ungrounded = response.validation?.ungrounded?.some((path) => path === call.name || path.startsWith(`${call.name}.`));
					if (strict && (ungrounded || response.validation?.negation)) {
						results.push({ error: "The model flagged this call as ungrounded." });
						continue;
					}
					const tools = this.options.tools;
					const definition = tools && !Array.isArray(tools) && Object.hasOwn(tools, call.name) ? tools[call.name] : void 0;
					if (!definition?.execute) {
						results.push({ error: `No execute function registered for ${call.name}.` });
						continue;
					}
					try {
						await validateToolInput(definition, call.arguments);
						signal.throwIfAborted();
						const value = await definition.execute(call.arguments, { abortSignal: signal });
						results.push(JSON.parse(JSON.stringify(value ?? null, (_key, item) => typeof item === "bigint" ? String(item) : item)));
					} catch (error) {
						signal.throwIfAborted();
						results.push({ error: errorMessage(error) });
					}
				}
				executed.push(...results);
				signal.throwIfAborted();
				response = await session.complete(JSON.stringify(results), completion);
			}
			checkSuccess(response);
			return {
				...response,
				results: executed
			};
		}, options.abortSignal);
	}
	async extract(text, schema, options = {}) {
		validateText(text, "text");
		const strict = strictOption(options.strict);
		const definition = tool({ inputSchema: schema });
		return this.use(async (session) => {
			await session.reset();
			const result = await session.complete(text, {
				tools: { extract: definition },
				...options.maxNewTokens === void 0 ? {} : { maxNewTokens: options.maxNewTokens }
			});
			checkSuccess(result);
			if (strict && (result.validation?.ungrounded?.length || result.validation?.negation)) throw new ExtractionValidationError();
			const call = result.function_calls.find((call) => call.name === "extract");
			if (!call) return null;
			await validateToolInput(definition, call.arguments);
			return call.arguments;
		}, options.abortSignal);
	}
};
//#endregion
export { Agent };

//# sourceMappingURL=client.js.map
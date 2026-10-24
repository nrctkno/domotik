
import { NeedleError } from "../errors.js";
import { Agent } from "../client.js";
import { shortcuts } from "../shortcuts.js";
import { SpeechClient } from "../speech-client.js";
import { readAudio } from "./audio.js";
import { loadSession } from "./session.js";
//#region src/browser/api.ts
function load(options, modelKind, signal) {
	if (options.weights !== void 0 && options.model !== void 0) throw new NeedleError("INVALID_ARGUMENT", "Supply weights or model, not both.");
	return loadSession({
		...options,
		stateless: false,
		abortSignal: options.abortSignal ? AbortSignal.any([signal, options.abortSignal]) : signal,
		...options.weights === void 0 ? {} : { model: options.weights }
	}, modelKind);
}
const Needle = class extends Agent {
	constructor(options = {}) {
		super((signal) => load(options, "needle3", signal), options);
	}
};
const Whistle = class extends SpeechClient {
	constructor(options = {}) {
		super((signal) => load(options, "whistle", signal), readAudio);
	}
};
const { transcribe, stream, extract, close } = shortcuts((options) => new Needle(options), (options) => new Whistle(options));
//#endregion
export { Needle, Whistle, close, extract, stream, transcribe };

//# sourceMappingURL=api.js.map
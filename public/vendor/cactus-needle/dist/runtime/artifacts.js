
import { files, model, repository, revision, speechModel } from "../vendor/manifest.js";
//#region src/runtime/artifacts.ts
const DEFAULT_MODEL = Object.freeze({
	name: "needle3",
	revision,
	size: model.size,
	sha256: model.sha256,
	url: `https://huggingface.co/${repository}/resolve/${revision}/${model.path}`
});
const MODEL_FILE = model.path;
const DEFAULT_SPEECH_MODEL = Object.freeze({
	name: "whistle",
	revision: speechModel.revision,
	size: speechModel.size,
	sha256: speechModel.sha256,
	url: `https://huggingface.co/${speechModel.repository}/resolve/${speechModel.revision}/${speechModel.path}`
});
const SPEECH_MODEL_FILE = speechModel.path;
Object.freeze(files["needle.wasm"]);
//#endregion
export { DEFAULT_MODEL, DEFAULT_SPEECH_MODEL, MODEL_FILE, SPEECH_MODEL_FILE };

//# sourceMappingURL=artifacts.js.map
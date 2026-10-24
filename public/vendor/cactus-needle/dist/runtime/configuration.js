
import { NeedleError, errorMessage, validateInteger, validateText } from "../errors.js";
import { normalizeTools } from "../tools.js";
//#region src/runtime/configuration.ts
function configuration(options) {
	const system = options.system ?? "";
	validateText(system, "system");
	if (options.stateless !== void 0 && typeof options.stateless !== "boolean") throw new NeedleError("INVALID_ARGUMENT", "stateless must be a boolean.");
	return {
		system,
		toolsJson: serializeTools(options.tools ?? []),
		stateless: options.stateless ?? false,
		bufferSize: validateInteger(options.bufferSize ?? 262144, "bufferSize", 1024, 16777216)
	};
}
function serializeTools(collection) {
	const tools = normalizeTools(collection);
	const names = /* @__PURE__ */ new Set();
	for (const entry of tools) {
		if (!entry || typeof entry !== "object") throw new NeedleError("INVALID_ARGUMENT", "Each tool must be a schema object.");
		const schema = entry && "type" in entry && entry.type === "function" ? entry.function : entry;
		if (!schema || typeof schema !== "object" || !("name" in schema)) throw new NeedleError("INVALID_ARGUMENT", "Each tool must be a schema object.");
		validateText(schema.name, "Tool name");
		if (!schema.name.trim() || names.has(schema.name)) throw new NeedleError("INVALID_ARGUMENT", "Tool names must be nonempty and unique.");
		if (!schema.parameters || typeof schema.parameters !== "object" || Array.isArray(schema.parameters)) throw new NeedleError("INVALID_ARGUMENT", `Tool ${schema.name} must have a parameters schema.`);
		names.add(schema.name);
	}
	try {
		return JSON.stringify(tools, (_key, value) => {
			if (typeof value === "function" || typeof value === "symbol" || typeof value === "number" && !Number.isFinite(value)) throw new Error("Tool definitions must contain JSON values.");
			return value;
		});
	} catch (cause) {
		throw new NeedleError("INVALID_ARGUMENT", `Tools must be JSON-serializable: ${errorMessage(cause)}`, { cause });
	}
}
//#endregion
export { configuration, serializeTools };

//# sourceMappingURL=configuration.js.map

import { NeedleError, errorMessage } from "./errors.js";
//#region src/tools.ts
const validators = /* @__PURE__ */ new WeakMap();
async function validateToolInput(definition, input) {
	const validate = validators.get(definition);
	if (validate && (await validate(input)).issues) throw new NeedleError("INVALID_ARGUMENT", "Tool input failed schema validation.");
}
/** Define a named tool's input once; its name comes from the tools object key. */
function tool(options) {
	let schema = options.inputSchema;
	let validate;
	if (!schema || typeof schema !== "object") throw new NeedleError("INVALID_ARGUMENT", "inputSchema must be an object schema.");
	if ("~standard" in schema) {
		const standard = schema["~standard"];
		if (standard?.version !== 1 || typeof standard.jsonSchema?.input !== "function") throw new NeedleError("INVALID_ARGUMENT", "Use a Standard JSON Schema library (such as Zod 4.2+) or a plain JSON Schema.");
		try {
			schema = standard.jsonSchema.input({ target: "draft-07" });
			if (standard.validate) validate = standard.validate.bind(standard);
		} catch (cause) {
			throw new NeedleError("INVALID_ARGUMENT", `Cannot convert inputSchema: ${errorMessage(cause)}`, { cause });
		}
	}
	if (schema.type !== "object") throw new NeedleError("INVALID_ARGUMENT", "A tool inputSchema must describe an object.");
	if (options.execute !== void 0 && typeof options.execute !== "function") throw new NeedleError("INVALID_ARGUMENT", "execute must be a function.");
	const definition = Object.freeze({
		inputSchema: schema,
		...options.description === void 0 ? {} : { description: options.description },
		...options.triggers === void 0 ? {} : { triggers: options.triggers },
		...options.execute === void 0 ? {} : { execute: options.execute }
	});
	if (validate) validators.set(definition, validate);
	return definition;
}
function normalizeTools(tools) {
	if (Array.isArray(tools)) return tools;
	if (!tools || typeof tools !== "object") throw new NeedleError("INVALID_ARGUMENT", "tools must be a named tool object or an array of schemas.");
	return Object.entries(tools).map(([name, value]) => {
		if (!value || typeof value !== "object" || !value.inputSchema) throw new NeedleError("INVALID_ARGUMENT", `Tool ${name} needs inputSchema. Use tool({ inputSchema, description }).`);
		return {
			name,
			parameters: value.inputSchema,
			...value.description === void 0 ? {} : { description: value.description },
			...value.triggers === void 0 ? {} : { triggers: value.triggers }
		};
	});
}
//#endregion
export { normalizeTools, tool, validateToolInput };

//# sourceMappingURL=tools.js.map

//#region src/errors.ts
var NeedleError = class extends Error {
	code;
	name = "NeedleError";
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
	}
};
var ExtractionValidationError = class extends NeedleError {
	name = "ExtractionValidationError";
	constructor(message = "The model returned values that are not grounded in the input.") {
		super("INVALID_RESPONSE", message);
	}
};
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function validateText(value, label) {
	if (typeof value !== "string" || value.includes("\0")) throw new NeedleError("INVALID_ARGUMENT", `${label} must be a string without null bytes.`);
}
function validateInteger(value, label, min, max) {
	if (!Number.isSafeInteger(value) || value < min || value > max) throw new NeedleError("INVALID_ARGUMENT", `${label} must be an integer between ${min} and ${max}.`);
	return value;
}
//#endregion
export { ExtractionValidationError, NeedleError, errorMessage, validateInteger, validateText };

//# sourceMappingURL=errors.js.map
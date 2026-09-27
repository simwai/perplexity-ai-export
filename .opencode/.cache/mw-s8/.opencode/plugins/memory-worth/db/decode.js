"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asNumber = asNumber;
exports.asText = asText;
exports.asOptionalText = asOptionalText;
function asNumber(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "bigint")
        return Number(value);
    throw new Error("Expected numeric database value");
}
function asText(value) {
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    throw new Error("Expected text database value");
}
function asOptionalText(value) {
    if (value === null || value === undefined)
        return undefined;
    return asText(value);
}

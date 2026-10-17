"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.err = err;
exports.from = from;
exports.fromAsync = fromAsync;
exports.isOk = isOk;
exports.isErr = isErr;
exports.isRecord = isRecord;
function ok(value) {
    return { ok: true, value };
}
function err(error) {
    return { ok: false, error };
}
function from(fn) {
    try {
        return ok(fn());
    }
    catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}
async function fromAsync(fn) {
    try {
        return ok(await fn());
    }
    catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}
function isOk(result) {
    return result.ok;
}
function isErr(result) {
    return !result.ok;
}
function isRecord(value) {
    return typeof value === "object" || typeof value === "function" ? value !== null : false;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSeededRandom = createSeededRandom;
exports.hashString = hashString;
exports.createSeededRandomResult = createSeededRandomResult;
const result_js_1 = require("./result.js");
function createSeededRandom(seed) {
    let s = seed | 0;
    if (s === 0)
        s = 1;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}
function createSeededRandomResult(seed) {
    return (0, result_js_1.from)(() => createSeededRandom(seed));
}

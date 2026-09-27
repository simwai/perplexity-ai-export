"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.epochNow = epochNow;
exports.epochInt = epochInt;
exports.daysAgo = daysAgo;
function epochNow() {
    return String(Math.floor(Date.now() / 1000));
}
function epochInt() {
    return Math.floor(Date.now() / 1000);
}
function daysAgo(days) {
    return String(Math.floor(Date.now() / 1000) - days * 86400);
}

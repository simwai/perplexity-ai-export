"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyInvalidation = applyInvalidation;
exports.isInvalidated = isInvalidated;
// Invalidation is an observation, not a clock: evidence counters are never
// reset here, so a revoked memory keeps its history for audit and recovery.
function applyInvalidation(status, observation) {
    switch (observation.cause) {
        case "contradiction":
        case "superseded":
        case "revoked":
            return status === "merged" ? status : "invalidated";
        default:
            return status;
    }
}
function isInvalidated(status) {
    return status === "invalidated";
}

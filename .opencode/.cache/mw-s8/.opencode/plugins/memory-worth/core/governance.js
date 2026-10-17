"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TUNING_PARAMS = exports.DEFAULT_GOVERNANCE_POLICY = void 0;
exports.validateTuningParams = validateTuningParams;
exports.shouldInvalidate = shouldInvalidate;
exports.computeStatus = computeStatus;
exports.createAuditEntry = createAuditEntry;
const result_js_1 = require("./result.js");
exports.DEFAULT_GOVERNANCE_POLICY = {
    invalidation_threshold: 0.2,
    merge_similarity_threshold: 0.85,
    auto_archive_after_days: 30,
    max_evidence_per_partition: 1000,
};
exports.DEFAULT_TUNING_PARAMS = {
    decay_rate: 0.3,
    trust_quantile: 0.3,
    doubt_quantile: 0.3,
    min_evidence: 5,
    active_partition: "general",
};
function validateTuningParams(params) {
    if (params.decay_rate !== undefined) {
        if (params.decay_rate <= 0 || params.decay_rate >= 1)
            return (0, result_js_1.err)("decay_rate must be between 0 and 1 (exclusive)");
    }
    if (params.trust_quantile !== undefined && params.doubt_quantile !== undefined) {
        if (params.trust_quantile <= params.doubt_quantile)
            return (0, result_js_1.err)("trust_quantile must be greater than doubt_quantile");
    }
    if (params.trust_quantile !== undefined) {
        if (params.trust_quantile <= 0 || params.trust_quantile >= 1)
            return (0, result_js_1.err)("trust_quantile must be between 0 and 1 (exclusive)");
    }
    if (params.doubt_quantile !== undefined) {
        if (params.doubt_quantile <= 0 || params.doubt_quantile >= 1)
            return (0, result_js_1.err)("doubt_quantile must be between 0 and 1 (exclusive)");
    }
    if (params.min_evidence !== undefined) {
        if (!Number.isInteger(params.min_evidence) || params.min_evidence < 1)
            return (0, result_js_1.err)("min_evidence must be a positive integer");
    }
    return (0, result_js_1.ok)(undefined);
}
function shouldInvalidate(trustScore, policy, ageDays) {
    if (trustScore < policy.invalidation_threshold)
        return true;
    if (ageDays > policy.auto_archive_after_days)
        return true;
    return false;
}
function computeStatus(trustLabel, ageDays, policy) {
    if (trustLabel === "low" && ageDays > 7)
        return "archived";
    if (ageDays > policy.auto_archive_after_days)
        return "archived";
    return "active";
}
function createAuditEntry(changedBy, rationale, oldValues, newValues) {
    return {
        changed_at: new Date().toISOString(),
        changed_by: changedBy,
        rationale,
        old_values: oldValues,
        new_values: newValues,
    };
}

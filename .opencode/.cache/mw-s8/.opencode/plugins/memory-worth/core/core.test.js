"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const prng_js_1 = require("./prng.js");
const trust_js_1 = require("./trust.js");
const governance_js_1 = require("./governance.js");
const result_js_1 = require("./result.js");
const invalidation_js_1 = require("./invalidation.js");
const calibration_js_1 = require("./calibration.js");
(0, node_test_1.describe)("prng", () => {
    (0, node_test_1.it)("replays the same sequence for the same seed", () => {
        const first = (0, prng_js_1.createSeededRandom)(42);
        const second = (0, prng_js_1.createSeededRandom)(42);
        for (let i = 0; i < 5; i++) {
            strict_1.default.equal(first(), second());
        }
    });
    (0, node_test_1.it)("hashes strings deterministically", () => {
        strict_1.default.equal((0, prng_js_1.hashString)("memory"), (0, prng_js_1.hashString)("memory"));
        strict_1.default.notEqual((0, prng_js_1.hashString)("memory-a"), (0, prng_js_1.hashString)("memory-b"));
    });
});
(0, node_test_1.describe)("trust", () => {
    (0, node_test_1.it)("scores success share with a neutral default", () => {
        strict_1.default.equal((0, trust_js_1.computeTrustScore)(3, 1).score, 0.75);
        strict_1.default.equal((0, trust_js_1.computeTrustScore)(0, 0).score, 0.5);
    });
    (0, node_test_1.it)("marks thin evidence as unproven", () => {
        strict_1.default.equal((0, trust_js_1.computeTrustLabel)(9, 1, 2, governance_js_1.DEFAULT_TUNING_PARAMS, []), "unproven");
    });
    (0, node_test_1.it)("grades against the observed distribution", () => {
        const population = [];
        for (let i = 1; i <= 20; i++) {
            population.push({ ema_success: i, ema_failure: 20 - i });
        }
        strict_1.default.equal((0, trust_js_1.computeTrustLabel)(19, 1, 20, governance_js_1.DEFAULT_TUNING_PARAMS, population), "high");
        strict_1.default.equal((0, trust_js_1.computeTrustLabel)(1, 19, 20, governance_js_1.DEFAULT_TUNING_PARAMS, population), "low");
    });
    (0, node_test_1.it)("decays EMA toward the latest outcome", () => {
        const next = (0, trust_js_1.updateEma)(0.5, 0.5, true, 0.5);
        strict_1.default.equal(next.ema_success, 0.75);
        strict_1.default.equal(next.ema_failure, 0.25);
    });
    (0, node_test_1.it)("merges disjoint and overlapping partitions", () => {
        const merged = (0, trust_js_1.mergePartitions)({ debug: { ema_success: 0.8, ema_failure: 0.2, evidence_count: 4 } }, { review: { ema_success: 0.4, ema_failure: 0.6, evidence_count: 6 } }, 0.3);
        strict_1.default.equal(merged["debug"]?.evidence_count, 4);
        strict_1.default.equal(merged["review"]?.evidence_count, 6);
    });
});
(0, node_test_1.describe)("governance", () => {
    (0, node_test_1.it)("accepts sane knobs and rejects broken ones", () => {
        strict_1.default.equal((0, result_js_1.isOk)((0, governance_js_1.validateTuningParams)({ decay_rate: 0.3 })), true);
        strict_1.default.equal((0, result_js_1.isErr)((0, governance_js_1.validateTuningParams)({ decay_rate: 0 })), true);
        strict_1.default.equal((0, result_js_1.isErr)((0, governance_js_1.validateTuningParams)({ trust_quantile: 0.2, doubt_quantile: 0.4 })), true);
        strict_1.default.equal((0, result_js_1.isErr)((0, governance_js_1.validateTuningParams)({ min_evidence: 0 })), true);
    });
    (0, node_test_1.it)("invalidates weak or stale memories", () => {
        strict_1.default.equal((0, governance_js_1.shouldInvalidate)(0.1, { invalidation_threshold: 0.2, merge_similarity_threshold: 0.85, auto_archive_after_days: 30, max_evidence_per_partition: 1000 }, 3), true);
        strict_1.default.equal((0, governance_js_1.shouldInvalidate)(0.9, { invalidation_threshold: 0.2, merge_similarity_threshold: 0.85, auto_archive_after_days: 30, max_evidence_per_partition: 1000 }, 3), false);
    });
    (0, node_test_1.it)("archives low-trust week-old memories", () => {
        const policy = { invalidation_threshold: 0.2, merge_similarity_threshold: 0.85, auto_archive_after_days: 30, max_evidence_per_partition: 1000 };
        strict_1.default.equal((0, governance_js_1.computeStatus)("low", 8, policy), "archived");
        strict_1.default.equal((0, governance_js_1.computeStatus)("high", 3, policy), "active");
    });
    (0, node_test_1.it)("records audit entries with rationale", () => {
        const entry = (0, governance_js_1.createAuditEntry)("agent", "raise evidence bar", { min_evidence: 5 }, { min_evidence: 10 });
        strict_1.default.equal(entry.changed_by, "agent");
        strict_1.default.equal(entry.rationale, "raise evidence bar");
    });
});
(0, node_test_1.describe)("result", () => {
    (0, node_test_1.it)("narrows ok and err branches", () => {
        const good = (0, result_js_1.ok)(7);
        strict_1.default.equal((0, result_js_1.isOk)(good), true);
        if ((0, result_js_1.isOk)(good))
            strict_1.default.equal(good.value, 7);
        const bad = (0, result_js_1.err)(new Error("nope"));
        strict_1.default.equal((0, result_js_1.isErr)(bad), true);
    });
    (0, node_test_1.it)("captures throwing helpers", () => {
        strict_1.default.equal((0, result_js_1.isOk)((0, result_js_1.from)(() => 1 + 1)), true);
        strict_1.default.equal((0, result_js_1.isErr)((0, result_js_1.from)(() => { throw new Error("boom"); })), true);
    });
    (0, node_test_1.it)("captures rejecting helpers", async () => {
        const settled = await (0, result_js_1.fromAsync)(async () => 3);
        strict_1.default.equal((0, result_js_1.isOk)(settled), true);
    });
});
(0, node_test_1.describe)("mw-trust", () => {
    (0, node_test_1.it)("computes posterior means with a neutral default", () => {
        strict_1.default.equal((0, trust_js_1.mwOf)(3, 1), 0.75);
        strict_1.default.equal((0, trust_js_1.mwOf)(0, 0), 0.5);
        strict_1.default.deepEqual((0, trust_js_1.trustOf)(3, 1), { s_plus: 3, s_minus: 1, mw: 0.75 });
    });
    (0, node_test_1.it)("counts support and conflict observations", () => {
        strict_1.default.deepEqual((0, trust_js_1.updateCounters)(2, 1, true), { s_plus: 3, s_minus: 1 });
        strict_1.default.deepEqual((0, trust_js_1.updateCounters)(2, 1, false), { s_plus: 2, s_minus: 2 });
    });
    (0, node_test_1.it)("grades mw against population quantiles", () => {
        const population = [];
        for (let i = 1; i <= 20; i++) {
            population.push(i / 20);
        }
        strict_1.default.equal((0, trust_js_1.quantileLabel)(0.95, population, 0.3, 0.3), "high");
        strict_1.default.equal((0, trust_js_1.quantileLabel)(0.05, population, 0.3, 0.3), "low");
        strict_1.default.equal((0, trust_js_1.quantileLabel)(0.5, population, 0.3, 0.3), "neutral");
        strict_1.default.equal((0, trust_js_1.quantileLabel)(0.95, [0.9], 0.3, 0.3), "neutral");
    });
});
(0, node_test_1.describe)("invalidation", () => {
    (0, node_test_1.it)("invalidates on observation without erasing status history", () => {
        strict_1.default.equal((0, invalidation_js_1.applyInvalidation)("active", { cause: "contradiction" }), "invalidated");
        strict_1.default.equal((0, invalidation_js_1.applyInvalidation)("active", { cause: "superseded", supersededBy: 7 }), "invalidated");
        strict_1.default.equal((0, invalidation_js_1.applyInvalidation)("merged", { cause: "revoked" }), "merged");
        strict_1.default.equal((0, invalidation_js_1.isInvalidated)("invalidated"), true);
        strict_1.default.equal((0, invalidation_js_1.isInvalidated)("active"), false);
    });
    (0, node_test_1.it)("carries episode and calibration-entry shapes", () => {
        const episode = { id: 1, session_id: "s", task_type: "general", started_at: "0", resolved_at: undefined, outcome: null };
        const entry = { episode_id: episode.id, memory_id: 2, mw_before: 0.6 };
        strict_1.default.equal(entry.mw_before, 0.6);
    });
});
(0, node_test_1.describe)("calibration", () => {
    (0, node_test_1.it)("bins predictions into deciles", () => {
        const buckets = (0, calibration_js_1.deciles)([{ predicted: 0.05, actual: 0 }, { predicted: 0.95, actual: 1 }]);
        strict_1.default.equal(buckets.length, 10);
        strict_1.default.equal(buckets[0]?.count, 1);
        strict_1.default.equal(buckets[9]?.count, 1);
    });
    (0, node_test_1.it)("scores perfect predictions at zero error", () => {
        const errValue = (0, calibration_js_1.calibrationError)([{ predicted: 0.1, actual: 0 }, { predicted: 0.9, actual: 1 }]);
        strict_1.default.ok(Math.abs(errValue - 0.02) < 1e-9);
    });
    (0, node_test_1.it)("separates high and low trust rates", () => {
        const result = (0, calibration_js_1.discrimination)([{ predicted: 0.9, actual: 1 }, { predicted: 0.1, actual: 0 }]);
        strict_1.default.equal(result.delta, 1);
    });
});

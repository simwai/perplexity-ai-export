import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectRegime, REGIMES } from "./regimes.js";
import { applyRegime } from "./policies.js";
import { computeOracle } from "./oracle.js";
import { computeStability } from "./metrics.js";
describe("regimes", () => {
    it("stays nominal on small samples", () => {
        assert.equal(detectRegime(0.5, 0, 4), "nominal");
    });
    it("escalates through watch, degraded, and quarantine", () => {
        assert.equal(detectRegime(0.06, 0.2, 120), "watch");
        assert.equal(detectRegime(0.12, 0.2, 40), "degraded");
        assert.equal(detectRegime(0.2, 0.01, 40), "quarantine");
    });
    it("keeps regime configs ordered by strictness", () => {
        assert.ok(REGIMES.quarantine.min_evidence > REGIMES.degraded.min_evidence);
        assert.ok(REGIMES.degraded.min_evidence > REGIMES.nominal.min_evidence);
    });
});
describe("policies", () => {
    it("freezes tuning in quarantine and enables it when nominal", () => {
        assert.ok(applyRegime("quarantine", REGIMES.quarantine).actions.includes("freeze_tuning"));
        assert.ok(applyRegime("nominal", REGIMES.nominal).actions.includes("auto_tune_enabled"));
    });
});
describe("oracle", () => {
    it("reports insufficient data as non-blocking", () => {
        const verdict = computeOracle({ total_memories: 2, total_outcomes: 1, calibration_error: 0, discrimination: 0, high_trust_rate: 0, low_trust_rate: 0 });
        assert.deepEqual(verdict.flags, ["insufficient_data"]);
    });
    it("flags worse-than-guessing scorers", () => {
        const verdict = computeOracle({ total_memories: 40, total_outcomes: 40, calibration_error: 0.2, discrimination: 0.2, high_trust_rate: 0.4, low_trust_rate: 0.5 });
        assert.ok(verdict.flags.includes("worse_than_guessing"));
        assert.equal(verdict.healthy, false);
    });
});
describe("metrics", () => {
    it("tracks calibration drift and outcome rate", () => {
        const current = { total_memories: 20, total_outcomes: 10, calibration_error: 0.1, discrimination: 0.2, high_trust_rate: 0.8, low_trust_rate: 0.4 };
        const previous = { total_memories: 20, total_outcomes: 8, calibration_error: 0.04, discrimination: 0.2, high_trust_rate: 0.8, low_trust_rate: 0.4 };
        const stability = computeStability(current, previous);
        assert.ok(Math.abs(stability.calibration_delta - 0.06) < 1e-9);
        assert.equal(stability.outcome_rate, 0.5);
    });
});

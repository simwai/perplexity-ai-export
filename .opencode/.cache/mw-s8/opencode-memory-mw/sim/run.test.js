import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EPISODES, POLICY_NAMES, SHIFT_AT, runAblation, runDecisive, selectDecayLambda } from "./experiment.js";
const SEED = 20260923;
describe("decisive", () => {
    it("reproduces the same verdict and regrets on rerun", () => {
        const first = runDecisive(SEED);
        const second = runDecisive(SEED);
        assert.equal(first.verdict, second.verdict);
        assert.deepEqual(first.reports.map((report) => report.regretB), second.reports.map((report) => report.regretB));
    });
    it("covers six policies with bounded counters", () => {
        const result = runDecisive(SEED);
        assert.equal(result.reports.length, 6);
        for (const name of POLICY_NAMES) {
            assert.ok(result.reports.some((report) => report.policy === name));
        }
        for (const report of result.reports) {
            assert.ok(report.regretA >= 0 && report.regretA <= EPISODES);
            assert.ok(report.regretB >= 0 && report.regretB <= EPISODES);
            assert.ok(report.ttrB === null || (report.ttrB >= 1 && report.ttrB <= EPISODES - SHIFT_AT));
            assert.ok(Number.isFinite(report.calibrationB));
        }
    });
    it("selects the sweep lambda deterministically", () => {
        assert.equal(selectDecayLambda(SEED), selectDecayLambda(SEED));
        assert.ok([0.05, 0.1, 0.2].includes(selectDecayLambda(SEED)));
    });
});
describe("ablations", () => {
    it("reproduces ablation outcomes on rerun", () => {
        const lambda = selectDecayLambda(SEED);
        for (const name of ["global-trust", "noisy-07-08", "noisy-05-05", "windowed-history", "no-snapshot"]) {
            assert.equal(runAblation(name, SEED, lambda).regretB, runAblation(name, SEED, lambda).regretB);
        }
    });
    it("separates global trust from partitioned trust", () => {
        const lambda = selectDecayLambda(SEED);
        const global = runAblation("global-trust", SEED, lambda);
        const snap = runAblation("no-snapshot", SEED, lambda);
        const noisy = runAblation("noisy-07-08", SEED, lambda);
        assert.ok(global.regretB > snap.regretB);
        assert.ok(noisy.regretB <= snap.regretB * 2);
    });
});

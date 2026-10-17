import { createSeededRandom } from "../../.opencode/plugins/memory-worth/core/prng.js";
import { mwOf } from "../../.opencode/plugins/memory-worth/core/trust.js";
import { calibrationError } from "../../.opencode/plugins/memory-worth/core/calibration.js";
export const EPISODES = 10000;
export const SHIFT_AT = 5000;
export const KEY_COUNT = 200;
export const TASK_TYPES = ["alpha", "beta", "gamma", "delta"];
export const WINDOW_SIZE = 500;
export const LAMBDA_CANDIDATES = [0.05, 0.1, 0.2];
export const NOISE_DETECT = 0.9;
export const NOISE_FALSE_ALARM = 0.05;
export const TTR_WINDOW = 50;
export const TTR_TARGET = 0.95;
export const TTR_LIMIT = 1000;
export const BOUNDARY_MARGIN = 0.2;
export const POLICY_NAMES = [
    "vanilla",
    "no-forgetting",
    "decay",
    "clean-invalidation",
    "noisy-invalidation",
    "governance-hyde",
];
export const ABLATION_NAMES = [
    "global-trust",
    "noisy-07-08",
    "noisy-05-05",
    "windowed-history",
    "no-snapshot",
];
export function keyTaskType(key) {
    return TASK_TYPES[key % TASK_TYPES.length] ?? "alpha";
}
export function flippedTypes(seed) {
    const out = [];
    for (let i = 0; i < TASK_TYPES.length; i++) {
        if ((i + seed) % 2 === 0) {
            const name = TASK_TYPES[i];
            if (name !== undefined)
                out.push(name);
        }
    }
    return out;
}
function flipsKey(key, flipped) {
    return flipped.includes(keyTaskType(key));
}
function freshBeliefs() {
    const beliefs = [];
    for (let i = 0; i < KEY_COUNT; i++) {
        beliefs.push({ first: null, support1: 0, support0: 0, ema: 0.5, current: null });
    }
    return beliefs;
}
function predict(policy, belief) {
    if (policy === "vanilla")
        return belief.first ?? 1;
    if (policy === "decay")
        return belief.ema >= 0.5 ? 1 : 0;
    return belief.support1 >= belief.support0 ? 1 : 0;
}
function predictedMw(policy, belief) {
    if (policy === "vanilla")
        return belief.first === null ? 0.5 : belief.first;
    if (policy === "decay")
        return belief.ema;
    return mwOf(belief.support1, belief.support0);
}
function observe(policy, belief, truth, noise, lambda, detect, falseAlarm) {
    switch (policy) {
        case "vanilla":
            if (belief.first === null)
                belief.first = truth;
            return;
        case "no-forgetting":
            if (truth === 1)
                belief.support1 += 1;
            else
                belief.support0 += 1;
            return;
        case "decay":
            belief.ema = belief.ema * (1 - lambda) + truth * lambda;
            return;
        case "clean-invalidation":
            if (belief.current === null)
                belief.current = truth;
            if (truth !== belief.current) {
                belief.current = truth;
                belief.support1 = 0;
                belief.support0 = 0;
            }
            if (truth === 1)
                belief.support1 += 1;
            else
                belief.support0 += 1;
            return;
        case "noisy-invalidation": {
            if (belief.current === null)
                belief.current = truth;
            const contradicts = truth !== belief.current;
            const fires = contradicts ? noise() < detect : noise() < falseAlarm;
            if (fires) {
                belief.current = truth;
                belief.support1 = 0;
                belief.support0 = 0;
            }
            if (truth === 1)
                belief.support1 += 1;
            else
                belief.support0 += 1;
            return;
        }
        case "governance-hyde":
            // Modeled sub-dimension: the expanded query corroborates the observation,
            // so each outcome counts double. Documented simplification, not real HyDE.
            if (belief.current === null)
                belief.current = truth;
            if (truth !== belief.current) {
                belief.current = truth;
                belief.support1 = 0;
                belief.support0 = 0;
            }
            if (truth === 1)
                belief.support1 += 2;
            else
                belief.support0 += 2;
            return;
    }
}
function runPolicy(policy, regime, seed, lambda, opts) {
    const queries = createSeededRandom(seed);
    const noise = createSeededRandom(seed ^ 0x9e3779b9);
    const detect = opts?.detect ?? NOISE_DETECT;
    const falseAlarm = opts?.falseAlarm ?? NOISE_FALSE_ALARM;
    const flipped = regime === "B" ? flippedTypes(seed) : [];
    const truth = [];
    for (let k = 0; k < KEY_COUNT; k++) {
        truth.push(queries() < 0.5 ? 0 : 1);
    }
    const original = [...truth];
    const beliefs = freshBeliefs();
    let regret = 0;
    let stale = 0;
    const pairs = [];
    const window = [];
    let ttr = null;
    for (let ep = 0; ep < EPISODES; ep++) {
        if (regime === "B" && ep === SHIFT_AT) {
            for (let k = 0; k < KEY_COUNT; k++) {
                if (flipsKey(k, flipped))
                    truth[k] = 1 - (truth[k] ?? 0);
            }
        }
        const key = Math.floor(queries() * KEY_COUNT);
        const belief = beliefs[key];
        if (!belief)
            continue;
        const guess = predict(policy, belief);
        const actual = truth[key] ?? 0;
        if (guess !== actual)
            regret += 1;
        if (regime === "B" && ep >= SHIFT_AT && flipsKey(key, flipped) && guess === (original[key] ?? 0)) {
            stale += 1;
        }
        pairs.push({ predicted: predictedMw(policy, belief), actual });
        observe(policy, belief, actual, noise, lambda, detect, falseAlarm);
        if (regime === "B" && ep >= SHIFT_AT) {
            window.push(guess === actual ? 1 : 0);
            if (window.length > TTR_WINDOW)
                window.shift();
            if (ttr === null && window.length === TTR_WINDOW) {
                let correct = 0;
                for (const hit of window) {
                    correct += hit;
                }
                if (correct / TTR_WINDOW >= TTR_TARGET)
                    ttr = ep - SHIFT_AT + 1;
            }
        }
    }
    return { regret, stale, pairs, ttr };
}
function windowedRun(seed) {
    const queries = createSeededRandom(seed);
    const flipped = flippedTypes(seed);
    const truth = [];
    for (let k = 0; k < KEY_COUNT; k++) {
        truth.push(queries() < 0.5 ? 0 : 1);
    }
    const original = [...truth];
    const histories = [];
    for (let k = 0; k < KEY_COUNT; k++) {
        histories.push([]);
    }
    let regret = 0;
    let stale = 0;
    const pairs = [];
    const window = [];
    let ttr = null;
    for (let ep = 0; ep < EPISODES; ep++) {
        if (ep === SHIFT_AT) {
            for (let k = 0; k < KEY_COUNT; k++) {
                if (flipsKey(k, flipped))
                    truth[k] = 1 - (truth[k] ?? 0);
            }
        }
        const key = Math.floor(queries() * KEY_COUNT);
        const history = histories[key] ?? [];
        let support1 = 0;
        for (const outcome of history) {
            support1 += outcome;
        }
        const guess = history.length === 0 ? 1 : support1 * 2 >= history.length ? 1 : 0;
        const actual = truth[key] ?? 0;
        if (guess !== actual)
            regret += 1;
        if (ep >= SHIFT_AT && flipsKey(key, flipped) && guess === (original[key] ?? 0)) {
            stale += 1;
        }
        pairs.push({ predicted: mwOf(support1, history.length - support1), actual });
        history.push(actual);
        if (history.length > WINDOW_SIZE)
            history.shift();
        if (ep >= SHIFT_AT) {
            window.push(guess === actual ? 1 : 0);
            if (window.length > TTR_WINDOW)
                window.shift();
            if (ttr === null && window.length === TTR_WINDOW) {
                let correct = 0;
                for (const hit of window) {
                    correct += hit;
                }
                if (correct / TTR_WINDOW >= TTR_TARGET)
                    ttr = ep - SHIFT_AT + 1;
            }
        }
    }
    return { regret, stale, pairs, ttr };
}
function globalRun(seed) {
    const queries = createSeededRandom(seed);
    const flipped = flippedTypes(seed);
    const truth = [];
    for (let k = 0; k < KEY_COUNT; k++) {
        truth.push(queries() < 0.5 ? 0 : 1);
    }
    const original = [...truth];
    let support1 = 0;
    let support0 = 0;
    let regret = 0;
    let stale = 0;
    const pairs = [];
    const window = [];
    let ttr = null;
    for (let ep = 0; ep < EPISODES; ep++) {
        if (ep === SHIFT_AT) {
            for (let k = 0; k < KEY_COUNT; k++) {
                if (flipsKey(k, flipped))
                    truth[k] = 1 - (truth[k] ?? 0);
            }
        }
        const key = Math.floor(queries() * KEY_COUNT);
        const guess = support1 + support0 === 0 ? 1 : support1 >= support0 ? 1 : 0;
        const actual = truth[key] ?? 0;
        if (guess !== actual)
            regret += 1;
        if (ep >= SHIFT_AT && flipsKey(key, flipped) && guess === (original[key] ?? 0)) {
            stale += 1;
        }
        pairs.push({ predicted: mwOf(support1, support0), actual });
        if (actual === 1)
            support1 += 1;
        else
            support0 += 1;
        if (ep >= SHIFT_AT) {
            window.push(guess === actual ? 1 : 0);
            if (window.length > TTR_WINDOW)
                window.shift();
            if (ttr === null && window.length === TTR_WINDOW) {
                let correct = 0;
                for (const hit of window) {
                    correct += hit;
                }
                if (correct / TTR_WINDOW >= TTR_TARGET)
                    ttr = ep - SHIFT_AT + 1;
            }
        }
    }
    return { regret, stale, pairs, ttr };
}
export function runAblation(name, seed, lambda) {
    switch (name) {
        case "global-trust": {
            const run = globalRun(seed);
            return {
                ablation: name,
                regretB: run.regret,
                staleRateB: run.stale / EPISODES,
                ttrB: run.ttr,
                note: "single shared counter: unflipped majority dominates flipped keys",
            };
        }
        case "noisy-07-08": {
            const noisy = runPolicy("noisy-invalidation", "B", seed, lambda, { detect: 0.7, falseAlarm: 0.2 });
            return {
                ablation: name,
                regretB: noisy.regret,
                staleRateB: noisy.stale / EPISODES,
                ttrB: noisy.ttr,
                note: "oracle at 0.7 detect / 0.2 false-alarm",
            };
        }
        case "noisy-05-05": {
            const noisy = runPolicy("noisy-invalidation", "B", seed, lambda, { detect: 0.5, falseAlarm: 0.5 });
            return {
                ablation: name,
                regretB: noisy.regret,
                staleRateB: noisy.stale / EPISODES,
                ttrB: noisy.ttr,
                note: "oracle at chance: invalidation carries no signal",
            };
        }
        case "windowed-history": {
            const run = windowedRun(seed);
            return {
                ablation: name,
                regretB: run.regret,
                staleRateB: run.stale / EPISODES,
                ttrB: run.ttr,
                note: `last-${WINDOW_SIZE} outcomes per key, no cross-shift memory`,
            };
        }
        case "no-snapshot": {
            const run = runPolicy("clean-invalidation", "B", seed, lambda);
            return {
                ablation: name,
                regretB: run.regret,
                staleRateB: run.stale / EPISODES,
                ttrB: run.ttr,
                note: "mw_before snapshot discarded: identical regret by construction (null)",
            };
        }
    }
}
export function selectDecayLambda(seed) {
    let best = LAMBDA_CANDIDATES[0] ?? 0.1;
    let bestRegret = Number.POSITIVE_INFINITY;
    for (const lambda of LAMBDA_CANDIDATES) {
        const regret = runPolicy("decay", "A", seed, lambda).regret;
        if (regret < bestRegret) {
            bestRegret = regret;
            best = lambda;
        }
    }
    return best;
}
function findReport(reports, policy) {
    for (const report of reports) {
        if (report.policy === policy)
            return report;
    }
    throw new Error(`missing report for ${policy}`);
}
export function runDecisive(seed) {
    const decayLambda = selectDecayLambda(seed);
    const reports = [];
    for (const policy of POLICY_NAMES) {
        const runA = runPolicy(policy, "A", seed, decayLambda);
        const runB = runPolicy(policy, "B", seed, decayLambda);
        reports.push({
            policy,
            regretA: runA.regret,
            regretB: runB.regret,
            staleRateB: runB.stale / EPISODES,
            ttrB: runB.ttr,
            calibrationB: calibrationError(runB.pairs),
        });
    }
    const vanillaB = findReport(reports, "vanilla").regretB;
    const clean = findReport(reports, "clean-invalidation");
    const margin = vanillaB > 0 ? (vanillaB - clean.regretB) / vanillaB : 0;
    const bounded = clean.ttrB !== null && clean.ttrB <= TTR_LIMIT;
    if (vanillaB > clean.regretB && margin >= BOUNDARY_MARGIN && bounded) {
        return {
            seed,
            decayLambda,
            reports,
            verdict: "BOUNDARY",
            rationale: `clean-invalidation regret ${clean.regretB} vs vanilla ${vanillaB} (margin ${(margin * 100).toFixed(1)}%), recovery in ${clean.ttrB} episodes`,
        };
    }
    return {
        seed,
        decayLambda,
        reports,
        verdict: "NO-BOUNDARY",
        rationale: `vanilla regret ${vanillaB}, clean regret ${clean.regretB}, margin ${(margin * 100).toFixed(1)}%, recovery ${clean.ttrB === null ? "unbounded" : `${clean.ttrB} episodes`}`,
    };
}

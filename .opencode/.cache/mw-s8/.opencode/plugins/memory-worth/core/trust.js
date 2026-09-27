"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeTrustLabel = computeTrustLabel;
exports.computeTrustScore = computeTrustScore;
exports.mwOf = mwOf;
exports.trustOf = trustOf;
exports.updateCounters = updateCounters;
exports.quantileLabel = quantileLabel;
exports.updateEma = updateEma;
exports.mergePartitions = mergePartitions;
function computeTrustLabel(emaSuccess, emaFailure, evidenceCount, params, allScores) {
    if (evidenceCount < params.min_evidence)
        return "unproven";
    const total = emaSuccess + emaFailure;
    if (total === 0)
        return "neutral";
    if (allScores.length < 10)
        return "neutral";
    const scores = allScores
        .map((r) => {
        const t = r.ema_success + r.ema_failure;
        return t === 0 ? 0.5 : r.ema_success / t;
    })
        .sort((a, b) => a - b);
    const highIdx = Math.min(Math.floor(scores.length * (1 - params.trust_quantile)), scores.length - 1);
    const lowIdx = Math.min(Math.floor(scores.length * params.doubt_quantile), scores.length - 1);
    const score = emaSuccess / total;
    if (score >= scores[highIdx])
        return "high";
    if (score <= scores[lowIdx])
        return "low";
    return "neutral";
}
function computeTrustScore(emaSuccess, emaFailure) {
    const total = emaSuccess + emaFailure;
    const score = total === 0 ? 0.5 : emaSuccess / total;
    return { ema_success: emaSuccess, ema_failure: emaFailure, evidence_count: 0, score, label: "neutral" };
}
function mwOf(sPlus, sMinus) {
    const total = sPlus + sMinus;
    return total <= 0 ? 0.5 : sPlus / total;
}
function trustOf(sPlus, sMinus) {
    return { s_plus: sPlus, s_minus: sMinus, mw: mwOf(sPlus, sMinus) };
}
function updateCounters(sPlus, sMinus, outcome) {
    return { s_plus: sPlus + (outcome ? 1 : 0), s_minus: sMinus + (outcome ? 0 : 1) };
}
function quantileLabel(mw, population, trustQ, doubtQ) {
    if (population.length < 10)
        return "neutral";
    const sorted = [...population].sort((a, b) => a - b);
    const highIdx = Math.min(Math.floor(sorted.length * (1 - trustQ)), sorted.length - 1);
    const lowIdx = Math.min(Math.floor(sorted.length * doubtQ), sorted.length - 1);
    const highCut = sorted[highIdx] ?? 0.5;
    const lowCut = sorted[lowIdx] ?? 0.5;
    if (mw >= highCut)
        return "high";
    if (mw <= lowCut)
        return "low";
    return "neutral";
}
function updateEma(currentSuccess, currentFailure, outcome, decay) {
    return {
        ema_success: currentSuccess * (1 - decay) + (outcome ? 1 : 0) * decay,
        ema_failure: currentFailure * (1 - decay) + (outcome ? 0 : 1) * decay,
    };
}
function mergePartitions(source, target, decay) {
    const result = { ...target };
    for (const [taskType, src] of Object.entries(source)) {
        if (result[taskType]) {
            const tgt = result[taskType];
            const sw = src.evidence_count || 1;
            const tw = tgt.evidence_count || 1;
            const tw2 = sw + tw;
            result[taskType] = {
                ema_success: (src.ema_success * sw + tgt.ema_success * tw) / tw2,
                ema_failure: (src.ema_failure * sw + tgt.ema_failure * tw) / tw2,
                evidence_count: tw2,
            };
        }
        else {
            result[taskType] = { ...src };
        }
    }
    return result;
}

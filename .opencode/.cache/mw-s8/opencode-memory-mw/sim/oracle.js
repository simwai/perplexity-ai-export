export function computeOracle(metrics) {
    const flags = [];
    let score = 1.0;
    if (metrics.total_memories < 10 || metrics.total_outcomes < 10) {
        flags.push("insufficient_data");
        return { healthy: true, score: 0.5, flags };
    }
    if (metrics.calibration_error > 0.15) {
        flags.push("calibration_degraded");
        score -= 0.3;
    }
    if (metrics.discrimination < 0.05 && metrics.total_memories > 20) {
        flags.push("poor_discrimination");
        score -= 0.3;
    }
    if (metrics.high_trust_rate < metrics.low_trust_rate + 0.05 && metrics.total_memories > 10) {
        flags.push("worse_than_guessing");
        score -= 0.4;
    }
    return { healthy: score > 0.5, score: Math.max(0, score), flags };
}

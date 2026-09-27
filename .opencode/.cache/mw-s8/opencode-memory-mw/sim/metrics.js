export function computeStability(current, previous) {
    const calibration_delta = previous ? Math.abs(current.calibration_error - previous.calibration_error) : 0;
    const scores = [current.high_trust_rate, current.low_trust_rate];
    let sum = 0;
    for (const score of scores) {
        sum += score;
    }
    const mean = sum / scores.length;
    let squared = 0;
    for (const score of scores) {
        squared += (score - mean) ** 2;
    }
    return {
        window_size: current.total_outcomes,
        calibration_delta,
        score_variance: squared / scores.length,
        outcome_rate: current.total_outcomes / Math.max(current.total_memories, 1),
    };
}

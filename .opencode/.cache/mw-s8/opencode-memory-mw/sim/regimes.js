export const REGIMES = {
    nominal: { name: "nominal", decay_rate: 0.3, trust_quantile: 0.3, doubt_quantile: 0.3, min_evidence: 5, auto_archive_after_days: 30, invalidation_threshold: 0.2 },
    watch: { name: "watch", decay_rate: 0.2, trust_quantile: 0.25, doubt_quantile: 0.25, min_evidence: 10, auto_archive_after_days: 14, invalidation_threshold: 0.25 },
    degraded: { name: "degraded", decay_rate: 0.5, trust_quantile: 0.4, doubt_quantile: 0.4, min_evidence: 20, auto_archive_after_days: 7, invalidation_threshold: 0.3 },
    quarantine: { name: "quarantine", decay_rate: 0.8, trust_quantile: 0.5, doubt_quantile: 0.5, min_evidence: 50, auto_archive_after_days: 1, invalidation_threshold: 0.5 },
};
export function detectRegime(calibrationError, discrimination, memoryCount) {
    if (memoryCount < 10)
        return "nominal";
    if (calibrationError > 0.15 && discrimination < 0.05)
        return "quarantine";
    if (calibrationError > 0.1 || discrimination < 0.05)
        return "degraded";
    if (calibrationError > 0.05 || memoryCount > 100)
        return "watch";
    return "nominal";
}

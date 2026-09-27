import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ABLATION_NAMES, EPISODES, KEY_COUNT, SHIFT_AT, flippedTypes, runAblation, runDecisive } from "./experiment.js";
const SEED = 20260923;
function row(cells) {
    return `| ${cells.join(" | ")} |`;
}
async function main() {
    const result = runDecisive(SEED);
    const lines = [];
    lines.push("# Stage 4 Report — Decisive Experiment");
    lines.push("");
    lines.push(`Seed: ${result.seed} (fixed; reruns reproduce every number below).`);
    lines.push(`Episodes: ${EPISODES} per regime; Regime B shifts at episode ${SHIFT_AT}; keys: ${KEY_COUNT}.`);
    lines.push(`Decay lambda from Regime-A sweep: ${result.decayLambda}.`);
    lines.push(`Caveats: synthetic keyed facts, clean outcome observation, exploratory constants; no LLM in the loop.`);
    lines.push("");
    lines.push(row(["policy", "regret A", "regret B", "stale rate B", "TTR B", "calibration B"]));
    lines.push(row(["---", "---:", "---:", "---:", "---:", "---:"]));
    for (const report of result.reports) {
        lines.push(row([
            report.policy,
            report.regretA,
            report.regretB,
            report.staleRateB.toFixed(3),
            report.ttrB === null ? "unbounded" : report.ttrB,
            report.calibrationB.toFixed(3),
        ]));
    }
    lines.push("");
    lines.push(`Verdict: ${result.verdict}`);
    lines.push(`Rationale: ${result.rationale}`);
    lines.push("");
    const root = join(process.cwd(), "opencode-memory-mw");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "STAGE4-REPORT.md"), lines.join("\n") + "\n", "utf-8");
    const ablation = [];
    ablation.push("# Ablations — Regime B knockouts");
    ablation.push("");
    ablation.push(`Seed: ${SEED} (fixed). Regime B flips task types: ${flippedTypes(SEED).join(", ")}.`);
    ablation.push("Null results reported, not hidden.");
    ablation.push("");
    ablation.push(row(["ablation", "regret B", "stale rate B", "TTR B", "note"]));
    ablation.push(row(["---", "---:", "---:", "---:", "---"]));
    for (const name of ABLATION_NAMES) {
        const report = runAblation(name, SEED, result.decayLambda);
        ablation.push(row([
            name,
            report.regretB,
            report.staleRateB.toFixed(3),
            report.ttrB === null ? "unbounded" : report.ttrB,
            report.note,
        ]));
    }
    ablation.push("");
    await writeFile(join(root, "sim", "ABLATIONS.md"), ablation.join("\n") + "\n", "utf-8");
}
await main();

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSessionOutcome = resolveSessionOutcome;
const decode_js_1 = require("../db/decode.js");
const queries_js_1 = require("../db/queries.js");
const outcome_js_1 = require("../outcome.js");
async function resolveSessionOutcome(db, sessionId, outputText) {
    if (!(0, outcome_js_1.isOutcomeSignal)(outputText))
        return { resolved: false };
    const outcome = (0, outcome_js_1.classifyOutcome)(outputText) === "success";
    const retrieved = await db.execute({
        sql: `SELECT ce.memory_id AS memory_id FROM calibration_entry ce JOIN episode e ON e.id = ce.episode_id WHERE e.session_id = ? AND e.resolved_at IS NULL`,
        args: [sessionId],
    });
    for (const row of retrieved.rows) {
        const memoryId = (0, decode_js_1.asNumber)(row["memory_id"]);
        if (memoryId)
            await (0, queries_js_1.applyOutcome)(db, memoryId, outcome);
    }
    await (0, queries_js_1.resolveEpisode)(db, sessionId, outcome);
    return { resolved: true };
}

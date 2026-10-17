"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSessionCreated = handleSessionCreated;
exports.handleSessionIdle = handleSessionIdle;
exports.handleSessionCompacted = handleSessionCompacted;
const decode_js_1 = require("../db/decode.js");
const queries_js_1 = require("../db/queries.js");
async function handleSessionCreated(db) {
    await (0, queries_js_1.ensureTaskType)(db, "general");
}
async function handleSessionIdle(db, sessionId) {
    const open = await db.execute({
        sql: `SELECT id FROM episode WHERE session_id = ? AND resolved_at IS NULL`,
        args: [sessionId],
    });
    let discarded = 0;
    let kept = 0;
    for (const row of open.rows) {
        const episodeId = (0, decode_js_1.asNumber)(row["id"]);
        const entries = await db.execute({
            sql: `SELECT id FROM calibration_entry WHERE episode_id = ? LIMIT 1`,
            args: [episodeId],
        });
        if (entries.rows.length === 0) {
            await db.execute({ sql: `DELETE FROM episode WHERE id = ?`, args: [episodeId] });
            discarded += 1;
        }
        else {
            kept += 1;
        }
    }
    return { discarded, kept };
}
async function handleSessionCompacted(db, sessionId) {
    const rows = await db.execute({
        sql: `SELECT COUNT(*) AS cnt FROM calibration_entry ce JOIN episode e ON e.id = ce.episode_id WHERE e.session_id = ? AND e.resolved_at IS NULL`,
        args: [sessionId],
    });
    return { unresolved_entries: (0, decode_js_1.asNumber)(rows.rows[0]?.["cnt"]) };
}

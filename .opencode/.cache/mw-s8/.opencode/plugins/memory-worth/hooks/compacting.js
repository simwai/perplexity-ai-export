"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCompactionContext = buildCompactionContext;
const decode_js_1 = require("../db/decode.js");
async function buildCompactionContext(db, sessionId) {
    const currents = await db.execute({
        sql: `SELECT m.id AS id, m.content AS content, m.mw AS mw FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE ms.name = 'active' ORDER BY m.mw DESC, m.usage_count DESC LIMIT 5`,
        args: [],
    });
    const lines = [
        `memory-worth: ${currents.rows.length} top memories preserved across compaction for session ${sessionId}.`,
    ];
    for (const row of currents.rows) {
        lines.push(`memory ${(0, decode_js_1.asNumber)(row["id"])} (mw ${(0, decode_js_1.asNumber)(row["mw"])}): ${(0, decode_js_1.asText)(row["content"]).slice(0, 120)}`);
    }
    return lines;
}

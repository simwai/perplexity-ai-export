"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInjectionTexts = buildInjectionTexts;
const decode_js_1 = require("../db/decode.js");
const queries_js_1 = require("../db/queries.js");
async function buildInjectionTexts(db, sessionId, isFirst) {
    if (!isFirst)
        return [];
    const stats = await (0, queries_js_1.getStatsFull)(db);
    const hits = await (0, queries_js_1.searchMemoriesFull)(db, "memory", { limit: 5, sessionId });
    const lines = [];
    lines.push(`memory-worth session digest: ${stats.total} memories, ${stats.unresolved_episodes} unresolved episodes.`);
    for (const hit of hits) {
        const tags = await db.execute({
            sql: `SELECT t.name AS name FROM tag t JOIN memory_tag mt ON t.id = mt.tag_id WHERE mt.memory_id = ? ORDER BY t.name LIMIT 3`,
            args: [hit.id],
        });
        const names = [];
        for (const row of tags.rows) {
            names.push((0, decode_js_1.asText)(row["name"]));
        }
        lines.push(`memory ${hit.id} (mw ${Math.round(hit.mw * 100) / 100}, ${hit.task_type}${names.length > 0 ? `, ${names.join(",")}` : ""}): ${hit.content.slice(0, 160)}`);
    }
    return lines;
}

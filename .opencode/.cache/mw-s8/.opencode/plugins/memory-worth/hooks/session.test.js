"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const client_1 = require("@libsql/client");
const decode_js_1 = require("../db/decode.js");
const migrate_js_1 = require("../db/migrate.js");
const queries_js_1 = require("../db/queries.js");
const queries_js_2 = require("../db/queries.js");
const chat_message_js_1 = require("./chat-message.js");
const compacting_js_1 = require("./compacting.js");
const session_events_js_1 = require("./session-events.js");
const tool_execute_after_js_1 = require("./tool-execute-after.js");
const SESSION = "session-test-s1";
let dir;
let db;
(0, node_test_1.before)(async () => {
    dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "mw-session-"));
    db = (0, client_1.createClient)({ url: `file:${(0, node_path_1.join)(dir, "session.db")}`, intMode: "number" });
    await (0, migrate_js_1.runMigrations)(db);
    await (0, session_events_js_1.handleSessionCreated)(db);
    await (0, queries_js_1.writeMemoryFull)(db, { content: "session sentinel alpha memory", applies_when: "session tests", taskType: "testing" });
    await (0, queries_js_1.writeMemoryFull)(db, { content: "session sentinel beta memory", applies_when: "session tests", taskType: "testing" });
});
(0, node_test_1.after)(async () => {
    db.close();
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
            return;
        }
        catch {
            if (attempt === 19)
                return;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
});
(0, node_test_1.describe)("session", () => {
    (0, node_test_1.it)("injects once per session", async () => {
        const first = await (0, chat_message_js_1.buildInjectionTexts)(db, SESSION, true);
        strict_1.default.ok(first.length > 0);
        strict_1.default.ok(first[0]?.includes("session digest"));
        strict_1.default.deepEqual(await (0, chat_message_js_1.buildInjectionTexts)(db, SESSION, false), []);
    });
    (0, node_test_1.it)("records calibration entries on search and resolves on outcome", async () => {
        const hits = await (0, queries_js_2.searchMemoriesFull)(db, "session sentinel", { limit: 5, sessionId: SESSION });
        strict_1.default.equal(hits.length, 2);
        const idle = await (0, session_events_js_1.handleSessionIdle)(db, SESSION);
        strict_1.default.equal(idle.kept, 1);
        strict_1.default.equal(idle.discarded, 0);
        const quiet = await (0, tool_execute_after_js_1.resolveSessionOutcome)(db, SESSION, "hello there");
        strict_1.default.equal(quiet.resolved, false);
        const resolved = await (0, tool_execute_after_js_1.resolveSessionOutcome)(db, SESSION, "all fixed and verified");
        strict_1.default.equal(resolved.resolved, true);
        const episodes = await db.execute({
            sql: `SELECT resolved_at AS resolved_at, outcome AS outcome FROM episode WHERE session_id = ?`,
            args: [SESSION],
        });
        strict_1.default.ok(episodes.rows.length > 0);
        for (const row of episodes.rows) {
            strict_1.default.ok(row["resolved_at"] !== null);
        }
        const memories = await db.execute({
            sql: `SELECT mw AS mw FROM memory WHERE content LIKE 'session sentinel%'`,
            args: [],
        });
        for (const row of memories.rows) {
            strict_1.default.ok((0, decode_js_1.asNumber)(row["mw"]) > 0.5);
        }
    });
    (0, node_test_1.it)("discards empty episodes on idle and reports compaction context", async () => {
        const empty = await (0, session_events_js_1.handleSessionIdle)(db, "session-test-empty");
        strict_1.default.equal(empty.discarded, 0);
        strict_1.default.equal(empty.kept, 0);
        const lines = await (0, compacting_js_1.buildCompactionContext)(db, SESSION);
        strict_1.default.ok(lines.length > 0);
        strict_1.default.ok(lines[0]?.includes("preserved across compaction"));
    });
});

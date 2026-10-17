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
const migrate_js_1 = require("./migrate.js");
const decode_js_1 = require("./decode.js");
const queries_js_1 = require("./queries.js");
let dir;
let db;
(0, node_test_1.before)(async () => {
    dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "mw-norm-"));
    db = (0, client_1.createClient)({ url: `file:${(0, node_path_1.join)(dir, "norm.db")}`, intMode: "number" });
    await (0, migrate_js_1.runMigrations)(db);
});
(0, node_test_1.after)(async () => {
    db.close();
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            (0, node_fs_1.rmSync)(dir, { recursive: true, force: true });
            return;
        }
        catch (e) {
            if (attempt === 19) {
                // Best-effort cleanup: the native binding can hold the file handle
                // past close() on Windows (EBUSY). Assertions already passed; the OS
                // temp directory reclaims the remainder. Never fail green tests here.
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
});
async function count(table) {
    const allowed = ["tag", "ground", "memory_tag", "memory", "episode", "calibration_entry"];
    if (!allowed.includes(table))
        throw new Error(`unexpected table ${table}`);
    const result = await db.execute({ sql: `SELECT COUNT(*) AS cnt FROM ${table}`, args: [] });
    return (0, decode_js_1.asNumber)(result.rows[0]?.["cnt"]);
}
(0, node_test_1.describe)("normalization", () => {
    (0, node_test_1.it)("round-trips 3 tags and 2 grounds with exact row counts", async () => {
        const written = await (0, queries_js_1.writeMemoryFull)(db, {
            content: "normalization sentinel memory",
            applies_when: "testing 3NF round-trips",
            tags: ["norm-a", "norm-b", "norm-c"],
            grounds: [
                { kind: "file", value: "src/index.ts" },
                { kind: "symbol", value: "writeMemoryFull" },
            ],
            taskType: "testing",
        });
        strict_1.default.equal(await count("tag"), 3);
        strict_1.default.equal(await count("ground"), 2);
        strict_1.default.equal(await count("memory_tag"), 3);
        strict_1.default.equal(await count("memory"), 1);
        const fetched = await (0, queries_js_1.getMemoryFull)(db, written.id);
        strict_1.default.ok(fetched !== null);
        strict_1.default.equal(fetched.content, "normalization sentinel memory");
        strict_1.default.equal(fetched.applies_when, "testing 3NF round-trips");
        strict_1.default.equal(fetched.task_type, "testing");
        strict_1.default.deepEqual(fetched.tags, ["norm-a", "norm-b", "norm-c"]);
        strict_1.default.deepEqual(fetched.grounds, [
            { kind: "file", value: "src/index.ts" },
            { kind: "symbol", value: "writeMemoryFull" },
        ]);
    });
    (0, node_test_1.it)("derives active retrievals from unresolved episodes", async () => {
        const hits = await db.execute({
            sql: `SELECT ce.memory_id AS memory_id FROM calibration_entry ce JOIN episode e ON e.id = ce.episode_id WHERE e.resolved_at IS NULL AND e.session_id = ?`,
            args: ["no-such-session"],
        });
        strict_1.default.equal(hits.rows.length, 0);
    });
});

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
const queries_js_1 = require("./queries.js");
const TASK = "rt-task";
const CONTENT = "roundtrip sentinel alpha memory for isolated database verification";
let dir;
let db;
(0, node_test_1.before)(async () => {
    dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "mw-roundtrip-"));
    db = (0, client_1.createClient)({ url: `file:${(0, node_path_1.join)(dir, "roundtrip.db")}`, intMode: "number" });
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
            if (attempt === 19)
                throw e;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
});
(0, node_test_1.describe)("round-trip", () => {
    (0, node_test_1.it)("writes and reads back a memory with its task type", async () => {
        const written = await (0, queries_js_1.writeMemory)(db, { content: CONTENT, tags: "rt, alpha" }, TASK, "active");
        const fetched = await (0, queries_js_1.getMemory)(db, written.id);
        strict_1.default.ok(fetched !== null);
        strict_1.default.equal(fetched.content, CONTENT);
        strict_1.default.equal(fetched.tags, "rt,alpha");
        strict_1.default.equal(fetched.task_type, TASK);
        strict_1.default.equal(fetched.evidence_count, 0);
    });
    (0, node_test_1.it)("search returns stored task types", async () => {
        const unfiltered = await (0, queries_js_1.searchMemories)(db, "roundtrip sentinel", 10);
        const hit = unfiltered.find((row) => row.content === CONTENT);
        strict_1.default.ok(hit !== undefined);
        strict_1.default.equal(hit.task_type, TASK);
        const filtered = await (0, queries_js_1.searchMemories)(db, "roundtrip sentinel", 10, TASK);
        strict_1.default.ok(filtered.some((row) => row.content === CONTENT));
    });
    (0, node_test_1.it)("records outcomes and updates trust evidence", async () => {
        const written = await (0, queries_js_1.writeMemory)(db, { content: "roundtrip outcome probe memory", tags: "rt" }, TASK, "active");
        const taskTypeId = await (0, queries_js_1.ensureTaskType)(db, TASK);
        await (0, queries_js_1.updateTrustScore)(db, written.id, true, taskTypeId);
        const fetched = await (0, queries_js_1.getMemory)(db, written.id);
        strict_1.default.ok(fetched !== null);
        strict_1.default.equal(fetched.evidence_count, 1);
        strict_1.default.ok(fetched.trust_score > 0.5);
    });
    (0, node_test_1.it)("seeds governance tuning params through migrations", async () => {
        const params = await (0, queries_js_1.getTuningParams)(db);
        strict_1.default.equal(params.decay_rate, 0.3);
        strict_1.default.equal(params.min_evidence, 5);
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA_VERSION = void 0;
exports.runMigrations = runMigrations;
exports.getSchemaVersion = getSchemaVersion;
const schema_js_1 = require("./schema.js");
Object.defineProperty(exports, "SCHEMA_VERSION", { enumerable: true, get: function () { return schema_js_1.SCHEMA_VERSION; } });
async function runMigrations(db) {
    await db.execute({ sql: `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`, args: [] });
    const versionResult = await db.execute({ sql: `SELECT MAX(version) AS v FROM schema_version`, args: [] });
    const raw = versionResult.rows[0]?.["v"];
    const currentVersion = typeof raw === "number" ? raw : 0;
    for (const migration of schema_js_1.MIGRATIONS) {
        if (migration.version <= currentVersion)
            continue;
        for (const sql of migration.statements) {
            await db.execute({ sql, args: [] });
        }
        for (const seed of migration.seed ?? []) {
            await db.execute({ sql: seed.sql, args: seed.args });
        }
        for (const p of migration.params ?? []) {
            await db.execute({
                sql: `INSERT OR IGNORE INTO tuning_param (key, value) VALUES (?, ?)`,
                args: [p.key, p.value],
            });
        }
        await db.execute({ sql: `INSERT INTO schema_version (version) VALUES (?)`, args: [migration.version] });
    }
}
async function getSchemaVersion(db) {
    const result = await db.execute({ sql: `SELECT MAX(version) AS v FROM schema_version`, args: [] });
    const raw = result.rows[0]?.["v"];
    return typeof raw === "number" ? raw : 0;
}

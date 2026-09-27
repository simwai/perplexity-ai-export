"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDbPath = getDbPath;
exports.createConnection = createConnection;
exports.getConnection = getConnection;
exports.closeConnection = closeConnection;
const client_1 = require("@libsql/client");
const promises_1 = require("node:fs/promises");
const path_js_1 = require("../runtime/shim/path.js");
const migrate_js_1 = require("./migrate.js");
const DB_FILENAME = "memory.db";
const DB_DIR = ".opencode";
let client = null;
function getDbPath(baseDir) {
    const path = (0, path_js_1.shimPath)();
    return path.join(path.resolve(baseDir, DB_DIR), DB_FILENAME);
}
async function createConnection(baseDir) {
    if (client)
        return client;
    const path = (0, path_js_1.shimPath)();
    const dir = path.resolve(baseDir, DB_DIR);
    try {
        await (0, promises_1.mkdir)(dir, { recursive: true });
    }
    catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "EEXIST") {
            // directory already exists
        }
        else {
            throw e;
        }
    }
    const created = (0, client_1.createClient)({ url: `file:${getDbPath(baseDir)}`, intMode: "number" });
    await (0, migrate_js_1.runMigrations)(created);
    client = created;
    return client;
}
function getConnection() {
    return client;
}
function closeConnection() {
    if (client) {
        client.close();
        client = null;
    }
}

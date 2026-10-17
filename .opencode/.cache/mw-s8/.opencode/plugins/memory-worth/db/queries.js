"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureTaskType = ensureTaskType;
exports.getStatusId = getStatusId;
exports.getTuningParams = getTuningParams;
exports.writeMemory = writeMemory;
exports.getMemory = getMemory;
exports.searchMemories = searchMemories;
exports.updateTrustScore = updateTrustScore;
exports.writeMemoryFull = writeMemoryFull;
exports.getMemoryFull = getMemoryFull;
exports.ensureEpisode = ensureEpisode;
exports.resolveEpisode = resolveEpisode;
exports.searchMemoriesFull = searchMemoriesFull;
exports.applyOutcome = applyOutcome;
exports.invalidateMemoryFull = invalidateMemoryFull;
exports.mergeMemoriesFull = mergeMemoriesFull;
exports.deleteMemoryFull = deleteMemoryFull;
exports.setStatusFull = setStatusFull;
exports.getStatsFull = getStatsFull;
exports.getParameter = getParameter;
exports.setParameter = setParameter;
exports.labelMemory = labelMemory;
exports.findDuplicateFull = findDuplicateFull;
exports.updateMemoryFull = updateMemoryFull;
const trust_js_1 = require("../core/trust.js");
const governance_js_1 = require("../core/governance.js");
const decode_js_1 = require("./decode.js");
const epoch_js_1 = require("./epoch.js");
function asRowId(value) {
    if (typeof value === "bigint")
        return Number(value);
    if (typeof value === "number")
        return value;
    throw new Error("Missing inserted row id");
}
async function ensureTaskType(db, name) {
    await db.execute({ sql: `INSERT OR IGNORE INTO task_type (name) VALUES (?)`, args: [name] });
    const found = await db.execute({ sql: `SELECT id FROM task_type WHERE name = ?`, args: [name] });
    return (0, decode_js_1.asNumber)(found.rows[0]?.["id"]);
}
async function getStatusId(db, name) {
    const found = await db.execute({ sql: `SELECT id FROM memory_status WHERE name = ?`, args: [name] });
    return (0, decode_js_1.asNumber)(found.rows[0]?.["id"]);
}
function parseTuningParams(rows) {
    const parsed = {};
    for (const row of rows) {
        parsed[row.key] = row.value;
    }
    const decay = Number(parsed["decay_rate"] ?? governance_js_1.DEFAULT_TUNING_PARAMS.decay_rate);
    const trustQ = Number(parsed["trust_quantile"] ?? governance_js_1.DEFAULT_TUNING_PARAMS.trust_quantile);
    const doubtQ = Number(parsed["doubt_quantile"] ?? governance_js_1.DEFAULT_TUNING_PARAMS.doubt_quantile);
    const minEv = Number(parsed["min_evidence"] ?? governance_js_1.DEFAULT_TUNING_PARAMS.min_evidence);
    return {
        decay_rate: Number.isFinite(decay) ? decay : governance_js_1.DEFAULT_TUNING_PARAMS.decay_rate,
        trust_quantile: Number.isFinite(trustQ) ? trustQ : governance_js_1.DEFAULT_TUNING_PARAMS.trust_quantile,
        doubt_quantile: Number.isFinite(doubtQ) ? doubtQ : governance_js_1.DEFAULT_TUNING_PARAMS.doubt_quantile,
        min_evidence: Number.isInteger(minEv) ? minEv : governance_js_1.DEFAULT_TUNING_PARAMS.min_evidence,
        active_partition: parsed["active_partition"] ?? governance_js_1.DEFAULT_TUNING_PARAMS.active_partition,
    };
}
async function getTuningParams(db) {
    const result = await db.execute({ sql: `SELECT key, value FROM tuning_param_legacy_v1`, args: [] });
    const rows = [];
    for (const row of result.rows) {
        rows.push({ key: (0, decode_js_1.asText)(row["key"]), value: (0, decode_js_1.asText)(row["value"]) });
    }
    return parseTuningParams(rows);
}
async function writeMemory(db, input, taskTypeName, statusName) {
    const taskTypeId = await ensureTaskType(db, taskTypeName);
    const statusId = await getStatusId(db, statusName);
    const now = (0, epoch_js_1.epochNow)();
    const inserted = await db.execute({
        sql: `INSERT INTO memory_legacy_v1 (content, memory_status_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        args: [input.content, statusId, now, now],
    });
    const memoryId = asRowId(inserted.lastInsertRowid);
    const tagNames = [];
    if (input.tags && input.tags.trim()) {
        for (const part of input.tags.split(",")) {
            const name = part.trim();
            if (name)
                tagNames.push(name);
        }
    }
    const writes = [];
    for (const tagName of tagNames) {
        writes.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] });
    }
    if (writes.length > 0) {
        await db.batch(writes, "write");
    }
    if (tagNames.length > 0) {
        const placeholders = tagNames.map(() => "?").join(", ");
        const tagRows = await db.execute({
            sql: `SELECT id, name FROM tag WHERE name IN (${placeholders})`,
            args: tagNames,
        });
        const links = [];
        for (const row of tagRows.rows) {
            links.push({
                sql: `INSERT OR IGNORE INTO memory_tag_link_legacy_v1 (memory_id, tag_id) VALUES (?, ?)`,
                args: [memoryId, (0, decode_js_1.asNumber)(row["id"])],
            });
        }
        links.push({
            sql: `INSERT OR IGNORE INTO memory_partition_legacy_v1 (memory_id, task_type_id) VALUES (?, ?)`,
            args: [memoryId, taskTypeId],
        });
        await db.batch(links, "write");
    }
    else {
        await db.execute({
            sql: `INSERT OR IGNORE INTO memory_partition_legacy_v1 (memory_id, task_type_id) VALUES (?, ?)`,
            args: [memoryId, taskTypeId],
        });
    }
    return { id: memoryId, content: input.content, tags: tagNames, task_type: taskTypeName };
}
async function loadTags(db, memoryIds) {
    const tagsByMemory = new Map();
    if (memoryIds.length === 0)
        return new Map();
    const placeholders = memoryIds.map(() => "?").join(", ");
    const tagRows = await db.execute({
        sql: `SELECT mtl.memory_id AS memory_id, t.name AS name FROM tag t JOIN memory_tag_link_legacy_v1 mtl ON t.id = mtl.tag_id WHERE mtl.memory_id IN (${placeholders})`,
        args: memoryIds,
    });
    for (const row of tagRows.rows) {
        const memoryId = (0, decode_js_1.asNumber)(row["memory_id"]);
        const name = (0, decode_js_1.asText)(row["name"]);
        const existing = tagsByMemory.get(memoryId) ?? [];
        existing.push(name);
        tagsByMemory.set(memoryId, existing);
    }
    const joined = new Map();
    for (const [memoryId, names] of tagsByMemory) {
        joined.set(memoryId, names.join(","));
    }
    return joined;
}
async function loadTaskTypes(db, memoryIds) {
    const typesByMemory = new Map();
    if (memoryIds.length === 0)
        return typesByMemory;
    const placeholders = memoryIds.map(() => "?").join(", ");
    const typeRows = await db.execute({
        sql: `SELECT mp.memory_id AS memory_id, tt.name AS name FROM task_type tt JOIN memory_partition_legacy_v1 mp ON tt.id = mp.task_type_id WHERE mp.memory_id IN (${placeholders}) ORDER BY mp.id`,
        args: memoryIds,
    });
    for (const row of typeRows.rows) {
        const memoryId = (0, decode_js_1.asNumber)(row["memory_id"]);
        if (!typesByMemory.has(memoryId)) {
            typesByMemory.set(memoryId, (0, decode_js_1.asText)(row["name"]));
        }
    }
    return typesByMemory;
}
async function getMemory(db, id) {
    const result = await db.execute({
        sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.created_at AS created_at FROM memory_legacy_v1 m WHERE m.id = ? AND m.deleted_at IS NULL`,
        args: [id],
    });
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    if (!row)
        return null;
    const tags = await loadTags(db, [id]);
    const taskTypes = await loadTaskTypes(db, [id]);
    const trust = (0, trust_js_1.computeTrustScore)((0, decode_js_1.asNumber)(row["ema_success"]), (0, decode_js_1.asNumber)(row["ema_failure"]));
    return {
        id: (0, decode_js_1.asNumber)(row["id"]),
        content: (0, decode_js_1.asText)(row["content"]),
        tags: tags.get(id) ?? "",
        task_type: taskTypes.get(id) ?? "general",
        trust_label: trust.label,
        trust_score: Math.round(trust.score * 100) / 100,
        evidence_count: (0, decode_js_1.asNumber)(row["evidence_count"]),
        created_at: (0, decode_js_1.asText)(row["created_at"]),
        rank: 0,
    };
}
async function searchMemories(db, query, limit, taskTypeName, sessionId) {
    const bounded = Math.max(1, Math.min(limit, 50));
    let taskTypeId;
    if (taskTypeName) {
        taskTypeId = await ensureTaskType(db, taskTypeName);
    }
    const rows = await db.execute({
        sql: `SELECT m.id AS id, m.content AS content, m.evidence_count AS evidence_count, m.ema_success AS ema_success, m.ema_failure AS ema_failure, m.created_at AS created_at, bm25(memory_fts) AS rank FROM memory_fts JOIN memory_legacy_v1 m ON m.id = memory_fts.rowid JOIN memory_status ms ON m.memory_status_id = ms.id WHERE memory_fts MATCH ? AND m.deleted_at IS NULL AND ms.name NOT IN ('invalidated', 'merged') ${taskTypeId !== undefined ? `AND m.id IN (SELECT memory_id FROM memory_partition_legacy_v1 WHERE task_type_id = ?)` : ``} ORDER BY rank LIMIT ?`,
        args: taskTypeId !== undefined ? [query, taskTypeId, bounded * 3] : [query, bounded * 3],
    });
    const found = [];
    for (const row of rows.rows) {
        found.push({
            id: (0, decode_js_1.asNumber)(row["id"]),
            content: (0, decode_js_1.asText)(row["content"]),
            evidence_count: (0, decode_js_1.asNumber)(row["evidence_count"]),
            ema_success: (0, decode_js_1.asNumber)(row["ema_success"]),
            ema_failure: (0, decode_js_1.asNumber)(row["ema_failure"]),
            created_at: (0, decode_js_1.asText)(row["created_at"]),
            rank: (0, decode_js_1.asNumber)(row["rank"]),
        });
    }
    const sliced = found.slice(0, bounded);
    const ids = [];
    for (const item of sliced) {
        ids.push(item.id);
    }
    const tags = await loadTags(db, ids);
    const taskTypes = await loadTaskTypes(db, ids);
    if (sessionId && ids.length > 0) {
        const now = (0, epoch_js_1.epochNow)();
        const retrievals = [];
        for (const id of ids) {
            retrievals.push({
                sql: `INSERT INTO session_memory_legacy_v1 (session_id, memory_id, retrieved_at) VALUES (?, ?, ?)`,
                args: [sessionId, id, now],
            });
        }
        await db.batch(retrievals, "write");
    }
    const results = [];
    for (const item of sliced) {
        const trust = (0, trust_js_1.computeTrustScore)(item.ema_success, item.ema_failure);
        results.push({
            id: item.id,
            content: item.content,
            tags: tags.get(item.id) ?? "",
            task_type: taskTypes.get(item.id) ?? "general",
            trust_label: trust.label,
            trust_score: Math.round(trust.score * 100) / 100,
            evidence_count: item.evidence_count,
            created_at: item.created_at,
            rank: item.rank,
        });
    }
    return results;
}
async function updateTrustScore(db, memoryId, outcome, taskTypeId) {
    const params = await getTuningParams(db);
    const memResult = await db.execute({
        sql: `SELECT ema_success, ema_failure, evidence_count FROM memory_legacy_v1 WHERE id = ?`,
        args: [memoryId],
    });
    if (memResult.rows.length === 0)
        return;
    const mem = memResult.rows[0];
    if (!mem)
        return;
    const next = (0, trust_js_1.updateEma)((0, decode_js_1.asNumber)(mem["ema_success"]), (0, decode_js_1.asNumber)(mem["ema_failure"]), outcome, params.decay_rate);
    const nextCount = (0, decode_js_1.asNumber)(mem["evidence_count"]) + 1;
    const now = (0, epoch_js_1.epochNow)();
    const partResult = await db.execute({
        sql: `SELECT id, ema_success, ema_failure, evidence_count FROM memory_partition_legacy_v1 WHERE memory_id = ? AND task_type_id = ?`,
        args: [memoryId, taskTypeId],
    });
    if (partResult.rows.length > 0) {
        const part = partResult.rows[0];
        if (!part)
            return;
        const nextPart = (0, trust_js_1.updateEma)((0, decode_js_1.asNumber)(part["ema_success"]), (0, decode_js_1.asNumber)(part["ema_failure"]), outcome, params.decay_rate);
        await db.batch([
            { sql: `UPDATE memory_legacy_v1 SET ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`, args: [next.ema_success, next.ema_failure, nextCount, now, memoryId] },
            { sql: `UPDATE memory_partition_legacy_v1 SET ema_success = ?, ema_failure = ?, evidence_count = ? WHERE id = ?`, args: [nextPart.ema_success, nextPart.ema_failure, (0, decode_js_1.asNumber)(part["evidence_count"]) + 1, (0, decode_js_1.asNumber)(part["id"])] },
        ], "write");
        return;
    }
    await db.batch([
        { sql: `UPDATE memory_legacy_v1 SET ema_success = ?, ema_failure = ?, evidence_count = ?, updated_at = ? WHERE id = ?`, args: [next.ema_success, next.ema_failure, nextCount, now, memoryId] },
        { sql: `INSERT INTO memory_partition_legacy_v1 (memory_id, task_type_id, ema_success, ema_failure, evidence_count) VALUES (?, ?, ?, ?, ?)`, args: [memoryId, taskTypeId, next.ema_success, next.ema_failure, 1] },
    ], "write");
}
async function lookupId(db, table, name) {
    await db.execute({ sql: `INSERT OR IGNORE INTO ${table} (name) VALUES (?)`, args: [name] });
    const found = await db.execute({ sql: `SELECT id FROM ${table} WHERE name = ?`, args: [name] });
    return (0, decode_js_1.asNumber)(found.rows[0]?.["id"]);
}
function escapeLike(query) {
    let out = "";
    for (const ch of query) {
        if (ch === "%" || ch === "_" || ch === "\\")
            out += "\\";
        out += ch;
    }
    return out;
}
async function writeMemoryFull(db, input) {
    const content = input.content.trim();
    const appliesWhen = input.applies_when.trim();
    if (!content)
        throw new Error("content is required");
    if (!appliesWhen)
        throw new Error("applies_when is required");
    const now = (0, epoch_js_1.epochInt)();
    const taskTypeId = await lookupId(db, "task_type", input.taskType ?? "general");
    const memoryTypeId = await lookupId(db, "memory_type", input.memoryType ?? "note");
    const statusId = await lookupId(db, "memory_status", "active");
    const tierId = await lookupId(db, "memory_tier", input.tier ?? "L1");
    const sourceId = await lookupId(db, "memory_source", input.source ?? "session");
    const inserted = await db.execute({
        sql: `INSERT INTO memory (content, applies_when, confidence, project, topic, task_type_id, memory_type_id, status_id, tier_id, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [content, appliesWhen, input.confidence ?? 50.0, input.project ?? "default", input.topic ?? null, taskTypeId, memoryTypeId, statusId, tierId, sourceId, now, now],
    });
    const memoryId = asRowId(inserted.lastInsertRowid);
    const tagNames = [];
    for (const raw of input.tags ?? []) {
        const name = raw.trim();
        if (name)
            tagNames.push(name);
    }
    if (tagNames.length > 0) {
        const inserts = [];
        for (const tagName of tagNames) {
            inserts.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] });
        }
        await db.batch(inserts, "write");
        const placeholders = tagNames.map(() => "?").join(", ");
        const tagRows = await db.execute({
            sql: `SELECT id FROM tag WHERE name IN (${placeholders})`,
            args: tagNames,
        });
        const links = [];
        for (const row of tagRows.rows) {
            links.push({ sql: `INSERT OR IGNORE INTO memory_tag (memory_id, tag_id) VALUES (?, ?)`, args: [memoryId, (0, decode_js_1.asNumber)(row["id"])] });
        }
        if (links.length > 0) {
            await db.batch(links, "write");
        }
    }
    const grounds = [];
    for (const ground of input.grounds ?? []) {
        const kindId = await lookupId(db, "ground_kind", ground.kind);
        grounds.push({
            sql: `INSERT OR IGNORE INTO ground (memory_id, ground_kind_id, value, fingerprint, verified_at) VALUES (?, ?, ?, ?, ?)`,
            args: [memoryId, kindId, ground.value, ground.fingerprint ?? null, now],
        });
    }
    if (grounds.length > 0) {
        await db.batch(grounds, "write");
    }
    return { id: memoryId };
}
async function loadSpecTags(db, memoryId) {
    const rows = await db.execute({
        sql: `SELECT t.name AS name FROM tag t JOIN memory_tag mt ON t.id = mt.tag_id WHERE mt.memory_id = ? ORDER BY t.name`,
        args: [memoryId],
    });
    const tags = [];
    for (const row of rows.rows) {
        tags.push((0, decode_js_1.asText)(row["name"]));
    }
    return tags;
}
async function loadSpecGrounds(db, memoryId) {
    const rows = await db.execute({
        sql: `SELECT gk.name AS kind, g.value AS value FROM ground g JOIN ground_kind gk ON g.ground_kind_id = gk.id WHERE g.memory_id = ? ORDER BY g.id`,
        args: [memoryId],
    });
    const grounds = [];
    for (const row of rows.rows) {
        grounds.push({ kind: (0, decode_js_1.asText)(row["kind"]), value: (0, decode_js_1.asText)(row["value"]) });
    }
    return grounds;
}
async function getMemoryFull(db, id) {
    const result = await db.execute({
        sql: `SELECT m.id AS id, m.content AS content, m.applies_when AS applies_when, m.confidence AS confidence, m.s_plus AS s_plus, m.s_minus AS s_minus, m.mw AS mw, m.usage_count AS usage_count, m.project AS project, m.topic AS topic, tt.name AS task_type, mt.name AS memory_type, ms.name AS status, mtr.name AS tier, msrc.name AS source, m.created_at AS created_at, m.updated_at AS updated_at FROM memory m JOIN task_type tt ON m.task_type_id = tt.id JOIN memory_type mt ON m.memory_type_id = mt.id JOIN memory_status ms ON m.status_id = ms.id JOIN memory_tier mtr ON m.tier_id = mtr.id JOIN memory_source msrc ON m.source_id = msrc.id WHERE m.id = ?`,
        args: [id],
    });
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    if (!row)
        return null;
    const memoryId = (0, decode_js_1.asNumber)(row["id"]);
    const tags = await loadSpecTags(db, memoryId);
    const grounds = await loadSpecGrounds(db, memoryId);
    const topicRaw = row["topic"];
    return {
        id: memoryId,
        content: (0, decode_js_1.asText)(row["content"]),
        applies_when: (0, decode_js_1.asText)(row["applies_when"]),
        confidence: (0, decode_js_1.asNumber)(row["confidence"]),
        s_plus: (0, decode_js_1.asNumber)(row["s_plus"]),
        s_minus: (0, decode_js_1.asNumber)(row["s_minus"]),
        mw: (0, decode_js_1.asNumber)(row["mw"]),
        usage_count: (0, decode_js_1.asNumber)(row["usage_count"]),
        project: (0, decode_js_1.asText)(row["project"]),
        topic: topicRaw === null || topicRaw === undefined ? undefined : (0, decode_js_1.asText)(topicRaw),
        task_type: (0, decode_js_1.asText)(row["task_type"]),
        memory_type: (0, decode_js_1.asText)(row["memory_type"]),
        status: (0, decode_js_1.asText)(row["status"]),
        tier: (0, decode_js_1.asText)(row["tier"]),
        source: (0, decode_js_1.asText)(row["source"]),
        created_at: (0, decode_js_1.asNumber)(row["created_at"]),
        updated_at: (0, decode_js_1.asNumber)(row["updated_at"]),
        tags,
        grounds,
    };
}
async function ensureEpisode(db, sessionId, taskTypeName) {
    const open = await db.execute({
        sql: `SELECT id FROM episode WHERE session_id = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1`,
        args: [sessionId],
    });
    if (open.rows.length > 0) {
        return (0, decode_js_1.asNumber)(open.rows[0]?.["id"]);
    }
    const taskTypeId = await lookupId(db, "task_type", taskTypeName);
    const inserted = await db.execute({
        sql: `INSERT INTO episode (session_id, task_type_id, started_at) VALUES (?, ?, ?)`,
        args: [sessionId, taskTypeId, (0, epoch_js_1.epochInt)()],
    });
    return asRowId(inserted.lastInsertRowid);
}
async function resolveEpisode(db, sessionId, outcome) {
    const result = await db.execute({
        sql: `UPDATE episode SET resolved_at = ?, outcome = ? WHERE session_id = ? AND resolved_at IS NULL`,
        args: [(0, epoch_js_1.epochInt)(), outcome ? 1 : 0, sessionId],
    });
    return result.rowsAffected;
}
async function searchMemoriesFull(db, query, opts = {}) {
    const trimmed = query.trim();
    if (!trimmed)
        return [];
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
    const conditions = [`ms.name = 'active'`, `(m.content LIKE ? ESCAPE '\\' OR m.applies_when LIKE ? ESCAPE '\\')`];
    const args = [`%${escapeLike(trimmed)}%`, `%${escapeLike(trimmed)}%`];
    if (opts.project !== undefined) {
        conditions.push(`m.project = ?`);
        args.push(opts.project);
    }
    if (opts.topic !== undefined) {
        conditions.push(`m.topic = ?`);
        args.push(opts.topic);
    }
    if (opts.tier !== undefined) {
        conditions.push(`m.tier_id = (SELECT id FROM memory_tier WHERE name = ?)`);
        args.push(opts.tier);
    }
    args.push(limit);
    const rows = await db.execute({
        sql: `SELECT m.id AS id, m.content AS content, m.mw AS mw, m.usage_count AS usage_count, tt.name AS task_type FROM memory m JOIN memory_status ms ON m.status_id = ms.id JOIN task_type tt ON m.task_type_id = tt.id WHERE ${conditions.join(" AND ")} ORDER BY m.mw DESC, m.usage_count DESC LIMIT ?`,
        args,
    });
    const hits = [];
    for (const row of rows.rows) {
        hits.push({
            id: (0, decode_js_1.asNumber)(row["id"]),
            content: (0, decode_js_1.asText)(row["content"]),
            mw: (0, decode_js_1.asNumber)(row["mw"]),
            usage_count: (0, decode_js_1.asNumber)(row["usage_count"]),
            task_type: (0, decode_js_1.asText)(row["task_type"]),
        });
    }
    if (opts.sessionId !== undefined && hits.length > 0) {
        const episodeId = await ensureEpisode(db, opts.sessionId, opts.taskType ?? "general");
        const entries = [];
        for (const hit of hits) {
            entries.push({
                sql: `INSERT OR IGNORE INTO calibration_entry (episode_id, memory_id, mw_before, created_at) VALUES (?, ?, ?, ?)`,
                args: [episodeId, hit.id, hit.mw, (0, epoch_js_1.epochInt)()],
            });
        }
        await db.batch(entries, "write");
        const usage = [];
        for (const hit of hits) {
            usage.push({ sql: `UPDATE memory SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`, args: [(0, epoch_js_1.epochInt)(), hit.id] });
        }
        await db.batch(usage, "write");
    }
    return hits;
}
async function applyOutcome(db, memoryId, outcome) {
    const found = await db.execute({
        sql: `SELECT s_plus, s_minus FROM memory WHERE id = ?`,
        args: [memoryId],
    });
    if (found.rows.length === 0)
        return;
    const row = found.rows[0];
    if (!row)
        return;
    const sPlus = (0, decode_js_1.asNumber)(row["s_plus"]) + (outcome ? 1 : 0);
    const sMinus = (0, decode_js_1.asNumber)(row["s_minus"]) + (outcome ? 0 : 1);
    await db.execute({
        sql: `UPDATE memory SET s_plus = ?, s_minus = ?, mw = ?, updated_at = ? WHERE id = ?`,
        args: [sPlus, sMinus, (0, trust_js_1.mwOf)(sPlus, sMinus), (0, epoch_js_1.epochInt)(), memoryId],
    });
}
async function invalidateMemoryFull(db, id) {
    const statusId = await lookupId(db, "memory_status", "invalidated");
    const result = await db.execute({
        sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`,
        args: [statusId, (0, epoch_js_1.epochInt)(), id],
    });
    return result.rowsAffected > 0;
}
async function mergeMemoriesFull(db, targetId, sourceIds, mergedContent) {
    const target = await getMemoryFull(db, targetId);
    if (!target)
        throw new Error(`target memory ${targetId} not found`);
    const archivedId = await lookupId(db, "memory_status", "archived");
    let sPlus = target.s_plus;
    let sMinus = target.s_minus;
    const removed = [];
    for (const sourceId of sourceIds) {
        if (sourceId === targetId)
            continue;
        const source = await getMemoryFull(db, sourceId);
        if (!source)
            continue;
        sPlus += source.s_plus;
        sMinus += source.s_minus;
        removed.push(sourceId);
    }
    const now = (0, epoch_js_1.epochInt)();
    const writes = [
        { sql: `UPDATE memory SET content = ?, s_plus = ?, s_minus = ?, mw = ?, updated_at = ? WHERE id = ?`, args: [mergedContent, sPlus, sMinus, (0, trust_js_1.mwOf)(sPlus, sMinus), now, targetId] },
    ];
    for (const sourceId of removed) {
        writes.push({ sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`, args: [archivedId, now, sourceId] });
    }
    await db.batch(writes, "write");
    return { kept: targetId, removed };
}
async function deleteMemoryFull(db, id) {
    const result = await db.execute({ sql: `DELETE FROM memory WHERE id = ?`, args: [id] });
    return result.rowsAffected > 0;
}
async function setStatusFull(db, id, status) {
    const statusId = await lookupId(db, "memory_status", status);
    const result = await db.execute({
        sql: `UPDATE memory SET status_id = ?, updated_at = ? WHERE id = ?`,
        args: [statusId, (0, epoch_js_1.epochInt)(), id],
    });
    return result.rowsAffected > 0;
}
async function getStatsFull(db) {
    const counts = await db.execute({
        sql: `SELECT ms.name AS status, COUNT(*) AS cnt FROM memory m JOIN memory_status ms ON m.status_id = ms.id GROUP BY ms.name`,
        args: [],
    });
    const byStatus = {};
    let total = 0;
    for (const row of counts.rows) {
        const cnt = (0, decode_js_1.asNumber)(row["cnt"]);
        byStatus[(0, decode_js_1.asText)(row["status"])] = cnt;
        total += cnt;
    }
    const avgRow = await db.execute({ sql: `SELECT AVG(mw) AS avg FROM memory`, args: [] });
    const avgRaw = avgRow.rows[0]?.["avg"];
    const episodes = await db.execute({ sql: `SELECT COUNT(*) AS cnt FROM episode`, args: [] });
    const unresolved = await db.execute({ sql: `SELECT COUNT(*) AS cnt FROM episode WHERE resolved_at IS NULL`, args: [] });
    return {
        total,
        by_status: byStatus,
        avg_mw: typeof avgRaw === "number" ? avgRaw : 0.5,
        episodes: (0, decode_js_1.asNumber)(episodes.rows[0]?.["cnt"]),
        unresolved_episodes: (0, decode_js_1.asNumber)(unresolved.rows[0]?.["cnt"]),
    };
}
async function getParameter(db, key, fallback) {
    const found = await db.execute({ sql: `SELECT value FROM parameter WHERE key = ?`, args: [key] });
    if (found.rows.length === 0)
        return fallback;
    return (0, decode_js_1.asText)(found.rows[0]?.["value"]);
}
async function setParameter(db, key, value, rationale) {
    const prior = await db.execute({ sql: `SELECT value FROM parameter WHERE key = ?`, args: [key] });
    const hasPrevious = prior.rows.length > 0;
    const previous = hasPrevious ? (0, decode_js_1.asText)(prior.rows[0]?.["value"]) : undefined;
    await db.batch([
        { sql: `INSERT INTO parameter (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [key, value] },
        {
            sql: `INSERT INTO parameter_change (knob, old_value, new_value, rationale, changed_at) VALUES (?, ?, ?, ?, ?)`,
            args: [key, previous ?? null, value, rationale, (0, epoch_js_1.epochInt)()],
        },
    ], "write");
    return { previous };
}
async function labelMemory(db, mw, sPlus, sMinus) {
    const minRaw = Number(await getParameter(db, "min_evidence", "3"));
    const minEv = Number.isFinite(minRaw) ? minRaw : 3;
    if (sPlus + sMinus < minEv)
        return "unproven";
    const rows = await db.execute({
        sql: `SELECT m.mw AS mw FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE ms.name = 'active'`,
        args: [],
    });
    const population = [];
    for (const row of rows.rows) {
        population.push((0, decode_js_1.asNumber)(row["mw"]));
    }
    const trustRaw = Number(await getParameter(db, "trust_q", "0.70"));
    const doubtRaw = Number(await getParameter(db, "doubt_q", "0.30"));
    return (0, trust_js_1.quantileLabel)(mw, population, Number.isFinite(trustRaw) ? trustRaw : 0.7, Number.isFinite(doubtRaw) ? doubtRaw : 0.3);
}
async function findDuplicateFull(db, content) {
    const found = await db.execute({
        sql: `SELECT m.id AS id FROM memory m JOIN memory_status ms ON m.status_id = ms.id WHERE m.content = ? AND ms.name = 'active' LIMIT 1`,
        args: [content.trim()],
    });
    if (found.rows.length === 0)
        return null;
    return (0, decode_js_1.asNumber)(found.rows[0]?.["id"]);
}
async function updateMemoryFull(db, id, content, tags) {
    const trimmed = content.trim();
    if (!trimmed)
        throw new Error("content is required");
    const now = (0, epoch_js_1.epochInt)();
    const writes = [
        { sql: `UPDATE memory SET content = ?, updated_at = ? WHERE id = ?`, args: [trimmed, now, id] },
        { sql: `DELETE FROM memory_tag WHERE memory_id = ?`, args: [id] },
    ];
    const tagNames = [];
    for (const raw of tags ?? []) {
        const name = raw.trim();
        if (name)
            tagNames.push(name);
    }
    for (const tagName of tagNames) {
        writes.push({ sql: `INSERT OR IGNORE INTO tag (name) VALUES (?)`, args: [tagName] });
    }
    await db.batch(writes, "write");
    if (tagNames.length > 0) {
        const placeholders = tagNames.map(() => "?").join(", ");
        const tagRows = await db.execute({
            sql: `SELECT id FROM tag WHERE name IN (${placeholders})`,
            args: tagNames,
        });
        const links = [];
        for (const row of tagRows.rows) {
            links.push({ sql: `INSERT OR IGNORE INTO memory_tag (memory_id, tag_id) VALUES (?, ?)`, args: [id, (0, decode_js_1.asNumber)(row["id"])] });
        }
        if (links.length > 0) {
            await db.batch(links, "write");
        }
    }
    const check = await db.execute({ sql: `SELECT id FROM memory WHERE id = ?`, args: [id] });
    return check.rows.length > 0;
}

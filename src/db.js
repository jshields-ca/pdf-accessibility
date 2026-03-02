'use strict';

/**
 * Job store — file-backed JSON persistence.
 *
 * All jobs are kept in an in-memory Map for fast access.
 * Whenever the store mutates it is synchronously flushed to a JSON file
 * (if DB_PATH is set and not ':memory:'), providing persistence across
 * server restarts without requiring a native SQLite binary.
 *
 * For production at high scale, replace this module with a PostgreSQL or
 * better-sqlite3 integration (compatible with Node ≤22 LTS).
 */

const fs = require('fs');
const path = require('path');

const isTest = process.env.NODE_ENV === 'test';
const DB_PATH = process.env.DB_PATH;

// Resolve persistence file path (null = in-memory only)
let dbFile = null;
if (!isTest && DB_PATH && DB_PATH !== ':memory:') {
  dbFile = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH);
  const dir = path.dirname(dbFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** @type {Map<string, object>} */
const store = new Map();

// Load persisted state on startup
if (dbFile && fs.existsSync(dbFile)) {
  try {
    const raw = fs.readFileSync(dbFile, 'utf8');
    const data = JSON.parse(raw);
    for (const [k, v] of Object.entries(data)) {
      store.set(k, v);
    }
  } catch (err) {
    // Corrupt file — start fresh; old records are lost
    console.error('[db] Failed to load job store, starting fresh:', err.message);
  }
}

function persist() {
  if (!dbFile) { return; }
  try {
    const obj = Object.fromEntries(store.entries());
    fs.writeFileSync(dbFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[db] Failed to persist job store:', err.message);
  }
}

function createJob(jobId, wcagLevel, originalFilename, filePath) {
  const now = Date.now();
  store.set(jobId, {
    jobId,
    status: 'pending',
    wcagLevel,
    originalFilename,
    filePath,
    reportPath: null,
    remediatedPath: null,
    issueCount: 0,
    fixedCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  persist();
}

function getJob(jobId) {
  return store.get(jobId) || null;
}

function updateJob(jobId, updates) {
  const existing = store.get(jobId);
  if (!existing) { return; }
  store.set(jobId, { ...existing, ...updates, updatedAt: Date.now() });
  persist();
}

function deleteJob(jobId) {
  store.delete(jobId);
  persist();
}

function getJobsOlderThan(ms) {
  const cutoff = Date.now() - ms;
  return [...store.values()].filter((j) => j.createdAt < cutoff);
}

// Expose store for testing
module.exports = { createJob, getJob, updateJob, deleteJob, getJobsOlderThan, store };

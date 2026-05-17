'use strict';

/**
 * Thin database abstraction supporting:
 *  - SQLite (default, file-based, zero-config local dev)
 *  - PostgreSQL (when DATABASE_URL is set, used for production deployments)
 *
 * All queries use `?` placeholders. For Postgres, they are translated to $1, $2, ...
 * Booleans are stored as 0/1 integers in both DBs for portability.
 *
 * Exposes a uniform async API:
 *   db.get(sql, params)   -> single row or undefined
 *   db.all(sql, params)   -> array of rows
 *   db.run(sql, params)   -> { changes, lastInsertRowid }
 *   db.exec(sql)          -> for DDL/multi-statement scripts
 *   db.tx(async (tx) => { ... }) -> transaction helper
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');

function translatePlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function buildSqliteDriver() {
  // Lazy require so production (Postgres) can omit the native binding entirely.
  // It is declared as an optionalDependency in package.json.
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    throw new Error(
      'SQLite mode requested but `better-sqlite3` is not installed. ' +
        'Set DATABASE_URL to use PostgreSQL instead, or run `npm install better-sqlite3` locally. ' +
        `Underlying error: ${err.message}`
    );
  }

  const dbPath = path.resolve(config.db.sqlitePath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return {
    kind: 'sqlite',
    raw: sqlite,
    async get(sql, params = []) {
      return sqlite.prepare(sql).get(...params);
    },
    async all(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const info = sqlite.prepare(sql).run(...params);
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid,
      };
    },
    async exec(sql) {
      sqlite.exec(sql);
    },
    async tx(fn) {
      // better-sqlite3 transactions are sync; wrap our async fn carefully.
      // We collect operations by executing them immediately under a BEGIN/COMMIT.
      sqlite.exec('BEGIN');
      try {
        const result = await fn(this);
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          sqlite.exec('ROLLBACK');
        } catch (_) {
          /* swallow rollback errors */
        }
        throw err;
      }
    },
    async close() {
      sqlite.close();
    },
  };
}

function buildPgDriver() {
  const { Pool } = require('pg');

  const ssl =
    config.db.url && /sslmode=require|render\.com|amazonaws\.com|neon\.tech/.test(config.db.url)
      ? { rejectUnauthorized: false }
      : false;

  const pool = new Pool({
    connectionString: config.db.url,
    ssl,
    max: 10,
  });

  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[db] Unexpected Postgres pool error:', err);
  });

  function adapt(sql) {
    return translatePlaceholders(sql);
  }

  async function runQuery(client, sql, params = []) {
    return client.query(adapt(sql), params);
  }

  function wrap(client) {
    return {
      kind: 'pg',
      raw: client,
      async get(sql, params = []) {
        const r = await runQuery(client, sql, params);
        return r.rows[0];
      },
      async all(sql, params = []) {
        const r = await runQuery(client, sql, params);
        return r.rows;
      },
      async run(sql, params = []) {
        const r = await runQuery(client, sql, params);
        return { changes: r.rowCount, lastInsertRowid: null };
      },
      async exec(sql) {
        await client.query(sql);
      },
    };
  }

  return {
    kind: 'pg',
    raw: pool,
    async get(sql, params = []) {
      const r = await pool.query(adapt(sql), params);
      return r.rows[0];
    },
    async all(sql, params = []) {
      const r = await pool.query(adapt(sql), params);
      return r.rows;
    },
    async run(sql, params = []) {
      const r = await pool.query(adapt(sql), params);
      return { changes: r.rowCount, lastInsertRowid: null };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {
          /* swallow rollback errors */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

let _db;

function getDb() {
  if (_db) return _db;
  if (config.db.url) {
    // eslint-disable-next-line no-console
    console.log('[db] Using PostgreSQL');
    _db = buildPgDriver();
  } else {
    // eslint-disable-next-line no-console
    console.log('[db] Using SQLite at', path.resolve(config.db.sqlitePath));
    _db = buildSqliteDriver();
  }
  return _db;
}

module.exports = { getDb };

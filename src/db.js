import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { getConfig, projectRoot } from './config.js';
import { logger } from './logger.js';
import { bootstrapAdminFromEnv } from './auth/adminUsers.js';

const { Pool } = pg;

/** Parse int8 as number for Telegram-sized ids (safe < 2^53 in practice). */
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => (val == null ? null : Number(val)));

let pool = null;
let lastDatabaseUrl = null;
let initPromise = null;

function maskDatabaseUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

/**
 * Build pg Pool options from DATABASE_URL.
 * SCRAM auth requires `password` to be a string — never undefined when a user is set.
 */
export function createPoolConfig(databaseUrl) {
  const connectionString = String(databaseUrl || '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured. Set it in .env or Settings → System.');
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    return { connectionString, max: 10 };
  }

  const config = {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 5432,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'sena'),
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };

  const user = parsed.username ? decodeURIComponent(parsed.username) : '';
  if (user) {
    config.user = user;
    config.password =
      parsed.password != null && String(parsed.password).length > 0
        ? decodeURIComponent(parsed.password)
        : '';
  } else if (process.env.PGUSER) {
    config.user = String(process.env.PGUSER);
    config.password = String(process.env.PGPASSWORD ?? '');
  }

  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode === 'require' || sslmode === 'verify-full' || sslmode === 'prefer') {
    config.ssl = sslmode === 'verify-full' ? { rejectUnauthorized: true } : true;
  }

  return config;
}

async function runMigrations(client) {
  const schemaPath = path.join(projectRoot, 'schema', 'postgres.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await client.query(sql);
}

/**
 * Close the pool. Call after changing database URL in settings or on shutdown.
 */
export async function resetDatabaseConnection() {
  initPromise = null;
  if (pool) {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    pool = null;
    lastDatabaseUrl = null;
  }
}

/**
 * Shared connection pool; runs schema migration on first connect.
 */
export async function getPool() {
  const { databaseUrl } = getConfig();
  if (pool && lastDatabaseUrl === databaseUrl) return pool;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        if (pool) {
          try {
            await pool.end();
          } catch {
            /* ignore */
          }
          pool = null;
          lastDatabaseUrl = null;
        }
        const next = new Pool(createPoolConfig(databaseUrl));
        const client = await next.connect();
        try {
          await runMigrations(client);
          await bootstrapAdminFromEnv((text, params) => client.query(text, params));
        } finally {
          client.release();
        }
        pool = next;
        lastDatabaseUrl = databaseUrl;
        logger.info(`PostgreSQL ready (${maskDatabaseUrl(databaseUrl)})`);
        return pool;
      } finally {
        initPromise = null;
      }
    })();
  }
  return initPromise;
}

export async function query(text, params = []) {
  const p = await getPool();
  return p.query(text, params);
}

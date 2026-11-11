import 'server-only'
import sql from 'mssql'

/*
 * One shared connection pool to the WOODYS_IND database (see db/001_accounts.sql).
 * Settings come from .env.local; the README lists them.
 */
const holder = globalThis as typeof globalThis & { __woodysDbPool?: Promise<sql.ConnectionPool> }

export class DatabaseNotConfigured extends Error {
  constructor() {
    super('Database is not configured: set DB_USER and DB_PASSWORD in .env.local.')
  }
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (holder.__woodysDbPool) return holder.__woodysDbPool
  const user = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  if (!user || !password) return Promise.reject(new DatabaseNotConfigured())

  const pool = new sql.ConnectionPool({
    server: process.env.DB_SERVER || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    database: process.env.DB_NAME || 'WOODYS_IND',
    user,
    password,
    options: {
      encrypt: true,
      // SQL Server on this machine uses a self-signed certificate.
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  })
  const connecting = pool.connect()
  // A failed connection isn't kept: the next request tries again.
  connecting.catch(() => {
    if (holder.__woodysDbPool === connecting) holder.__woodysDbPool = undefined
  })
  holder.__woodysDbPool = connecting
  return connecting
}

/** A new request on the pool. Always pass values with .input(), never in the SQL text. */
export async function query(): Promise<sql.Request> {
  return (await getPool()).request()
}

export { sql }

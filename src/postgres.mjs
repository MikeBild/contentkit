import pg from 'pg'

const { Pool } = pg

const TABLES = new Set([
  'ck_sites',
  'ck_site_domains',
  'ck_site_locales',
  'ck_api_keys',
  'ck_content_items',
  'ck_content_revisions',
  'ck_assets',
  'ck_releases',
  'ck_release_entries',
  'ck_preview_access',
  'ck_comments',
  'ck_contact_submissions',
  'ck_post_feedback',
  'ck_outbox_events',
  'ck_webhook_endpoints',
  'ck_webhook_deliveries',
  'ck_audio_jobs',
  'ck_access_users',
  'ck_access_groups',
  'ck_access_group_members',
  'ck_access_rules',
  'ck_release_access_entries',
  'ck_reader_sessions',
  'ck_release_access_catalog',
  'ck_reader_auth_events',
  'ck_deck_build_events',
  'ck_usage_events',
])

function assertKnownContentkitIdentifiers(text) {
  for (const match of text.matchAll(/\bck_[a-z0-9_]*/g)) {
    if (!TABLES.has(match[0])) throw new Error(`unknown Contentkit table in query: ${match[0]}`)
  }
}

// Whitelisted SQL functions rpc() may call. Each entry pins the exact statement
// and parameter order, so callers can never influence the SQL shape — an
// unknown name throws, exactly like an unknown table.
const FUNCTIONS = {
  ck_activate_release: {
    sql: 'SELECT public.ck_activate_release($1, $2, $3, $4)',
    values: (body) => [
      body.p_release_id,
      body.p_revision_ids || [],
      body.p_retire_item_ids || [],
      body.p_expected_epoch ?? null,
    ],
    result: () => null,
  },
  ck_search_published: {
    sql: 'SELECT * FROM public.ck_search_published($1, $2, $3, $4, $5)',
    values: (body) => [body.p_site_id, body.p_query, body.p_locale ?? null, body.p_kind ?? null, body.p_limit],
    result: (response) => response.rows,
  },
}

function identifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`invalid SQL identifier: ${value}`)
  return `"${value}"`
}

function tableName(value) {
  if (!TABLES.has(value)) throw new Error(`unknown Contentkit table: ${value}`)
  return `"public".${identifier(value)}`
}

function whereClause(filters, values) {
  const clauses = []
  for (const [column, raw] of Object.entries(filters || {})) {
    if (column === 'order' || column === 'limit' || raw === undefined) continue
    const name = identifier(column)
    const expression = String(raw)
    if (expression === 'is.null') clauses.push(`${name} IS NULL`)
    else if (expression === 'not.is.null') clauses.push(`${name} IS NOT NULL`)
    else if (expression.startsWith('eq.')) {
      values.push(expression.slice(3))
      clauses.push(`${name} = $${values.length}`)
    } else if (expression.startsWith('lte.')) {
      values.push(expression.slice(4))
      clauses.push(`${name} <= $${values.length}`)
    } else if (expression.startsWith('in.(') && expression.endsWith(')')) {
      const entries = expression.slice(4, -1).split(',').filter(Boolean)
      if (!entries.length) clauses.push('FALSE')
      else {
        const parameters = entries.map((entry) => {
          values.push(entry)
          return `$${values.length}`
        })
        clauses.push(`${name} IN (${parameters.join(', ')})`)
      }
    } else {
      throw new Error(`unsupported database filter for ${column}`)
    }
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
}

function orderClause(order) {
  if (!order) return ''
  const [column, direction = 'asc'] = String(order).split('.')
  if (!['asc', 'desc'].includes(direction.toLowerCase())) throw new Error('invalid database sort direction')
  return ` ORDER BY ${identifier(column)} ${direction.toUpperCase()}`
}

function limitClause(limit, values) {
  if (limit === undefined) return ''
  const parsed = Number(limit)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10000) throw new Error('invalid database limit')
  values.push(parsed)
  return ` LIMIT $${values.length}`
}

// Builds the query API bound to a single executor (the pool for autocommit
// calls, or a checked-out client inside db.tx). Every method is executor-agnostic
// so the same repository code runs transactionally or not.
function makeApi(exec) {
  return {
    async query(text, values = []) {
      assertKnownContentkitIdentifiers(text)
      return (await exec(text, values)).rows
    },

    async select(table, query = {}) {
      const values = []
      const sql = `SELECT * FROM ${tableName(table)}${whereClause(query, values)}${orderClause(query.order)}${limitClause(query.limit, values)}`
      return (await exec(sql, values)).rows
    },

    async insert(table, body, { returning = true, upsert = false, onConflict } = {}) {
      const rows = Array.isArray(body) ? body : [body]
      if (!rows.length) return []
      const columns = Object.keys(rows[0])
      if (!columns.length || rows.some((row) => columns.some((column) => !(column in row)))) {
        throw new Error('database insert rows must have the same non-empty shape')
      }
      const values = []
      const groups = rows.map(
        (row) =>
          `(${columns
            .map((column) => {
              values.push(row[column])
              return `$${values.length}`
            })
            .join(', ')})`,
      )
      let conflict = ''
      if (upsert) {
        const targets = String(onConflict || '')
          .split(',')
          .filter(Boolean)
        if (!targets.length) throw new Error('upsert requires onConflict')
        const targetSql = targets.map(identifier).join(', ')
        const updates = columns
          .filter((column) => !targets.includes(column))
          .map((column) => `${identifier(column)} = EXCLUDED.${identifier(column)}`)
        conflict = ` ON CONFLICT (${targetSql}) ${updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING'}`
      }
      const sql = `INSERT INTO ${tableName(table)} (${columns.map(identifier).join(', ')}) VALUES ${groups.join(', ')}${conflict}${returning ? ' RETURNING *' : ''}`
      return returning ? (await exec(sql, values)).rows : (await exec(sql, values), null)
    },

    async update(table, filters, body, { returning = true } = {}) {
      const columns = Object.keys(body)
      if (!columns.length) return []
      const values = columns.map((column) => body[column])
      const set = columns.map((column, index) => `${identifier(column)} = $${index + 1}`).join(', ')
      const where = whereClause(filters, values)
      if (!where) throw new Error('refusing unfiltered database update')
      const sql = `UPDATE ${tableName(table)} SET ${set}${where}${returning ? ' RETURNING *' : ''}`
      return returning ? (await exec(sql, values)).rows : (await exec(sql, values), null)
    },

    async remove(table, filters) {
      const values = []
      const where = whereClause(filters, values)
      if (!where) throw new Error('refusing unfiltered database delete')
      await exec(`DELETE FROM ${tableName(table)}${where}`, values)
    },

    async rpc(name, body = {}) {
      const fn = FUNCTIONS[name]
      if (!fn) throw new Error(`unknown Contentkit function: ${name}`)
      return fn.result(await exec(fn.sql, fn.values(body)))
    },
  }
}

export function createPostgres(config, options = {}) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required')
  const pool = options.pool || new Pool({ connectionString: config.databaseUrl, max: options.max || 10 })

  const db = makeApi((sql, values) => pool.query(sql, values))

  // Runs fn inside a single transaction. fn receives a db-shaped API bound to the
  // transaction's client, so a business write and its outbox enqueue commit atomically.
  db.tx = async (fn) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const txApi = makeApi((sql, values) => client.query(sql, values))
      const result = await fn(txApi)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  return {
    db,
    pool,
    async close() {
      if (!options.pool) await pool.end()
    },
  }
}

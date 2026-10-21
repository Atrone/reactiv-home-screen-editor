import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A configuration as stored. `data` is raw JSON; the service validates (and would migrate) it on read. */
export type StoredConfiguration = {
  id: string;
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  data: unknown;
};

export type ConfigurationWrite = {
  id: string;
  schemaVersion: number;
  data: unknown;
  updatedAt: string;
};

export type UpdateResult =
  | { status: "updated"; configuration: StoredConfiguration }
  | { status: "not_found" }
  | { status: "revision_mismatch"; currentRevision: number };

/**
 * Storage port for the configuration service. Async on purpose: node:sqlite happens to be
 * synchronous, but a networked database (Postgres) can implement this without touching handlers.
 */
export interface ConfigurationRepository {
  get(id: string): Promise<StoredConfiguration | null>;
  /** Inserts revision 1. Resolves null when the id is already taken; never overwrites. */
  create(input: ConfigurationWrite): Promise<StoredConfiguration | null>;
  /** Compare-and-set: writes only when the stored revision equals `expectedRevision`. */
  update(input: ConfigurationWrite & { expectedRevision: number }): Promise<UpdateResult>;
}

/** One row per configuration. The whole screen is stored as one JSON document because it is always read and written as a unit. */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS configurations (
    id             TEXT    PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    revision       INTEGER NOT NULL CHECK (revision > 0),
    updated_at     TEXT    NOT NULL,
    data           TEXT    NOT NULL CHECK (json_valid(data))
  ) STRICT;
`;

const COLUMNS = "id, schema_version, revision, updated_at, data";

type Row = { id: string; schema_version: number; revision: number; updated_at: string; data: string };

/**
 * Opens (creating if needed) the SQLite database and ensures the table exists.
 *
 * @param path - File path, or ":memory:" for tests.
 * @returns An open database handle.
 */
export function openDatabase(path: string): DatabaseSync {
  // node:sqlite will not create missing parent folders on its own.
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new DatabaseSync(path);
  // Idempotent: safe to run on every start.
  database.exec(SCHEMA_SQL);
  return database;
}

/**
 * SQLite implementation of {@link ConfigurationRepository}.
 *
 * @param database - An open database from {@link openDatabase}.
 * @returns The repository.
 */
export function createSqliteRepository(database: DatabaseSync): ConfigurationRepository {
  // Statements are prepared once and reused for every request.
  const selectById = database.prepare(`SELECT ${COLUMNS} FROM configurations WHERE id = ?`);
  const insertIfAbsent = database.prepare(
    `INSERT INTO configurations (${COLUMNS}) VALUES (?, ?, 1, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING ${COLUMNS}`,
  );
  // The revision check and the write are one statement, so two writers holding the same
  // revision cannot both succeed: SQLite serializes writes and the loser matches zero rows.
  const updateIfRevisionMatches = database.prepare(
    `UPDATE configurations
        SET schema_version = ?, data = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ?
  RETURNING ${COLUMNS}`,
  );
  const selectRevision = database.prepare("SELECT revision FROM configurations WHERE id = ?");

  return {
    /**
     * Loads one configuration.
     *
     * @param id - Configuration id.
     * @returns The stored configuration or null.
     */
    async get(id) {
      // A missing row is a normal outcome (404), not an error.
      const row = selectById.get(id) as Row | undefined;
      return row ? fromRow(row) : null;
    },

    /**
     * Inserts a new configuration at revision 1.
     *
     * @param input - Id, schema version, payload and timestamp.
     * @returns The stored configuration, or null if the id already exists.
     */
    async create(input) {
      // ON CONFLICT DO NOTHING returns no row when the id exists, which callers map to 409.
      const row = insertIfAbsent.get(input.id, input.schemaVersion, input.updatedAt, JSON.stringify(input.data)) as Row | undefined;
      return row ? fromRow(row) : null;
    },

    /**
     * Replaces a configuration's payload if the caller's revision is still current.
     *
     * @param input - New payload plus the revision the caller last read.
     * @returns Updated row, or why the update did not happen.
     */
    async update(input) {
      const row = updateIfRevisionMatches.get(
        input.schemaVersion,
        JSON.stringify(input.data),
        input.updatedAt,
        input.id,
        input.expectedRevision,
      ) as Row | undefined;
      if (row) {
        return { status: "updated", configuration: fromRow(row) };
      }

      // Zero rows matched: either the id does not exist or someone saved a newer revision.
      const current = selectRevision.get(input.id) as { revision: number } | undefined;
      return current ? { status: "revision_mismatch", currentRevision: current.revision } : { status: "not_found" };
    },
  };
}

/**
 * Maps a database row to the repository's camelCase shape.
 *
 * @param row - Raw row.
 * @returns The stored configuration with `data` parsed from JSON.
 */
function fromRow(row: Row): StoredConfiguration {
  // json_valid() in the table definition guarantees this parse succeeds.
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    revision: row.revision,
    updatedAt: row.updated_at,
    data: JSON.parse(row.data) as unknown,
  };
}

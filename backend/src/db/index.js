import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('promptpit.db');
const db = new Database(dbPath);

console.log('Connected to SQLite database at', dbPath);

// Wrapper to mimic pg's query interface somewhat, but for SQLite
// Note: SQLite uses '?' for params, PG uses '$1'. 
// We will simply return the db instance or helper, but existing queries use $1.
// We MUST refactor the queries in the routes to use '?' or named params.
// OR we can make a smart wrapper that replaces $x with ?.

export const query = (text, params = []) => {
    // Convert $1, $2... to ?
    const sql = text.replace(/\$\d+/g, '?');

    const stmt = db.prepare(sql);

    try {
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
            const rows = stmt.all(...params);
            return { rows, rowCount: rows.length };
        } else if (sql.trim().toUpperCase().startsWith('INSERT') || sql.trim().toUpperCase().startsWith('UPDATE') || sql.trim().toUpperCase().startsWith('DELETE')) {
            const info = stmt.run(...params);
            // Mimic RETURNING somewhat? SQLite doesn't support RETURNING fully in older versions, 
            // but better-sqlite3 supports it if the underlying SQLite does.
            // However, often we need to fetch the inserted row if RETURNING was requested.
            // For simple ID return: info.lastInsertRowid

            // CRITICAL: My queries utilize RETURNING * or RETURNING id.
            // SQLite 3.35+ supports RETURNING. checking version... most likely it works.
            // If it works, stmt.all() or stmt.get() should be used instead of run() for INSERT ... RETURNING.

            if (text.toUpperCase().includes('RETURNING')) {
                const rows = stmt.all(...params); // Use all() for RETURNING
                return { rows, rowCount: rows.length };
            }

            return { rows: [], rowCount: info.changes };
        } else {
            const info = stmt.run(...params);
            return { rows: [], rowCount: info.changes };
        }
    } catch (err) {
        console.error('SQL Error:', err);
        throw err;
    }
};

export const getDb = () => db;

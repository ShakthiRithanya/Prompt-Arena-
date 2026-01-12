
import { query } from './index.js';

async function run() {
    console.log('--- USERS ---');
    const users = await query('SELECT id, username, email FROM users');
    console.table(users.rows);

    console.log('\n--- BATTLES (Active) ---');
    const battles = await query("SELECT id, status, player_a_id, player_b_id FROM battles WHERE status IN ('WAITING', 'IN_PROGRESS')");
    console.table(battles.rows);
}

run();

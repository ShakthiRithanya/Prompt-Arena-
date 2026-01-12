
import { query } from './index.js';
import { v4 as uuidv4 } from 'uuid';

async function run() {
    console.log('--- SCHEMA ---');
    const schema = await query("SELECT sql FROM sqlite_master WHERE name = 'battles'");
    console.log(schema.rows[0]?.sql);

    console.log('\n--- TEST INSERT ---');
    const id = uuidv4();
    try {
        // Just insert a dummy battle to test constraints
        // We need valid user/challenge IDs.
        const users = await query('SELECT id FROM users LIMIT 1');
        const user = users.rows[0];
        const challenges = await query('SELECT id FROM challenges LIMIT 1');
        const challenge = challenges.rows[0];

        if (!user || !challenge) {
            console.log('No user or challenge found to test insert');
            return;
        }

        console.log(`Attempting insert with ID: ${id}`);
        await query(
            `INSERT INTO battles (id, challenge_id, status, player_a_id) VALUES ($1, $2, 'WAITING', $3)`,
            [id, challenge.id, user.id]
        );
        console.log('Insert SUCCESS');
    } catch (e) {
        console.error('Insert FAILED:', e.message);
    }
}

run();

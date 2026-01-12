
import { query } from './index.js';

async function run() {
    console.log('--- CLEARING BATTLES (CASCADE) ---');
    // Delete children first
    await query("DELETE FROM llm_responses");
    await query("DELETE FROM votes");
    await query("DELETE FROM prompt_submissions");
    await query("DELETE FROM battles");
    console.log('All battles cleared.');
}

run();

import { getDb } from './index.js';

const db = getDb();

console.log('--- USERS ---');
const users = db.prepare('SELECT * FROM users').all();
console.table(users);

console.log('\n--- BATTLES ---');
const battles = db.prepare('SELECT * FROM battles').all();
console.table(battles);

console.log('\n--- CHALLENGES ---');
const challenges = db.prepare('SELECT * FROM challenges').all();
console.table(challenges);

console.log('\n--- CATEGORIES ---');
const categories = db.prepare('SELECT * FROM categories').all();
console.table(categories);

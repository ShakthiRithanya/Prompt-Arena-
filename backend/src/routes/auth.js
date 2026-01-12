import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { z } from 'zod';

const router = express.Router();
// In production, use process.env.JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

const RegisterSchema = z.object({
    username: z.string().min(3),
    email: z.string().email(),
    password: z.string().min(6),
});

const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// Register
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = RegisterSchema.parse(req.body);

        const hash = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        console.log('Register attempt:', { userId, username, email });

        // SQLite/PG wrapper handles $1 -> ? translation or named params if implemented
        // But since I implemented a regex replacer in db/index.js, $1 is fine.

        const result = await query(
            `INSERT INTO users (id, username, email, password_hash) 
       VALUES ($1, $2, $3, $4) RETURNING id, username, email`,
            [userId, username, email, hash]
        );

        console.log('Register query result:', result);
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ user, token });
    } catch (error) {
        console.error(error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE'))) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = LoginSchema.parse(req.body);

        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ user: { id: user.id, username: user.username }, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing token' });

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await query('SELECT id, username, email, rating, wins, losses FROM users WHERE id = $1', [decoded.id]);
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

export default router;

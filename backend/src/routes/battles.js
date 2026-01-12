import express from 'express';
import { query } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Middleware to verify token
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing token' });

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { id: ... }
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Create or Join Battle (Quick Play)
router.post('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        console.log(`Matchmaking request received for User: ${userId}`);

        // 1. Check if there is a WAITING battle where I am NOT the player A
        const openBattle = await query(
            `SELECT * FROM battles WHERE status = 'WAITING' AND player_a_id != $1 LIMIT 1`,
            [userId]
        );

        if (openBattle.rows.length > 0) {
            // JOIN EXISTING BATTLE
            const battle = openBattle.rows[0];
            await query(
                `UPDATE battles SET player_b_id = $1, status = 'IN_PROGRESS' WHERE id = $2`,
                [userId, battle.id]
            );

            // Fetch updated battle with usernames to broadcast
            const updatedBattleRes = await query(`
                SELECT b.*, c.title, c.description,
                       u1.username as player_a_username,
                       u2.username as player_b_username
                FROM battles b
                LEFT JOIN challenges c ON b.challenge_id = c.id
                LEFT JOIN users u1 ON b.player_a_id = u1.id
                LEFT JOIN users u2 ON b.player_b_id = u2.id
                WHERE b.id = $1
            `, [battle.id]);

            const updatedBattle = updatedBattleRes.rows[0];

            // Use req.io attached in middleware
            req.io.to(battle.id).emit('battle-update', updatedBattle);

            console.log(`User ${userId} joined battle ${battle.id}`);
            return res.json({ battleId: battle.id, status: 'joined' });
        }

        // 2. CHECK IF I ALREADY HAVE A WAITING BATTLE (Idempotency check)
        const myExistingBattle = await query(
            `SELECT id FROM battles WHERE status = 'WAITING' AND player_a_id = $1 LIMIT 1`,
            [userId]
        );

        if (myExistingBattle.rows.length > 0) {
            const existingId = myExistingBattle.rows[0].id;
            console.log(`User ${userId} retrieving existing waiting battle ${existingId}`);
            return res.json({ battleId: existingId, status: 'restored' });
        }

        // NO OPEN BATTLES -> CREATE WAITING ROOM (Standard PvP)
        // Pick a random challenge
        const challengeRes = await query('SELECT id FROM challenges ORDER BY RANDOM() LIMIT 1');
        let challengeId = challengeRes.rows[0]?.id;

        if (!challengeId) {
            await query(`INSERT INTO categories (name, slug) VALUES ('General', 'general') ON CONFLICT DO NOTHING`);
            const cat = await query(`SELECT id FROM categories LIMIT 1`);
            const ins = await query(`INSERT INTO challenges (category_id, title, description, difficulty) VALUES ($1, 'Write a haiku about code', 'Make it poetic.', 'easy') RETURNING id`, [cat.rows[0].id]);
            challengeId = ins.rows[0].id;
        }

        let battleRes;
        let attempts = 0;
        while (attempts < 3) {
            const battleId = uuidv4();
            console.log(`Attempt ${attempts + 1}: Generated battleId ${battleId} for user ${userId}`);

            try {
                battleRes = await query(
                    `INSERT INTO battles (id, challenge_id, status, player_a_id)
                     VALUES ($1, $2, 'WAITING', $3) RETURNING id`,
                    [battleId, challengeId, userId]
                );
                break; // Success
            } catch (insertErr) {
                console.error(`Insert failed with UUID ${battleId}:`, insertErr.message);
                if (insertErr.message.includes('UNIQUE constraint failed')) {
                    attempts++;
                    continue;
                }
                throw insertErr; // Re-throw other errors
            }
        }

        if (!battleRes || !battleRes.rows[0]) {
            throw new Error('Failed to generate unique battle ID after 3 attempts');
        }

        console.log(`User ${userId} created waiting battle ${battleRes.rows[0].id}`);
        res.json({ battleId: battleRes.rows[0].id, status: 'created' });

    } catch (err) {
        console.error('Matchmaking error:', err);
        res.status(500).json({ error: 'Failed to create battle', details: err.message, stack: err.stack });
    }
});

// Join Battle (Explicit)
router.post('/:id/join', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        await query(
            `UPDATE battles SET player_b_id = $1, status = 'IN_PROGRESS' WHERE id = $2 AND status = 'WAITING'`,
            [userId, id]
        );
        res.json({ status: 'joined' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to join' });
    }
});

// Get Battle State
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Join with challenge data to return title/description
        const battle = await query(`
      SELECT b.*, c.title, c.description,
             u1.username as player_a_username,
             u2.username as player_b_username
      FROM battles b
      LEFT JOIN challenges c ON b.challenge_id = c.id
      LEFT JOIN users u1 ON b.player_a_id = u1.id
      LEFT JOIN users u2 ON b.player_b_id = u2.id
      WHERE b.id = $1
    `, [id]);

        const battleData = battle.rows[0];
        if (!battleData) return res.status(404).json({ error: 'Battle not found' });

        // If VOTING or FINISHED, fetch the LLM responses
        if (battleData.status === 'VOTING' || battleData.status === 'FINISHED') {
            const responses = await query(`
                SELECT r.response_text, r.model_name, s.user_id 
                FROM llm_responses r
                JOIN prompt_submissions s ON r.prompt_submission_id = s.id
                WHERE s.battle_id = $1
             `, [id]);
            battleData.responses = responses.rows;
        }

        res.json(battleData);
    } catch (err) {
        console.error(err);
        res.status(404).json({ error: 'Battle not found' });
    }
});

// Submit Prompt
// Submit Prompt
router.post('/:id/submit', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { prompt } = req.body;

        if (!prompt) return res.status(400).json({ error: 'Prompt required' });

        // 1. Save Submission
        const submissionId = uuidv4();
        await query(
            `INSERT INTO prompt_submissions (id, battle_id, user_id, prompt_text) VALUES ($1, $2, $3, $4)`,
            [submissionId, id, userId, prompt]
        );

        // 2. Check if both players have submitted
        const submissions = await query(
            `SELECT * FROM prompt_submissions WHERE battle_id = $1`,
            [id]
        );

        // We expect 2 submissions for the battle to proceed
        if (submissions.rows.length >= 2) {
            // TRANSITION TO EVALUATION (VOTING)
            await query(
                `UPDATE battles SET status = 'VOTING' WHERE id = $1`,
                [id]
            );

            // 3. GENERATE MOCK LLM RESPONSES (Simulated)
            for (const sub of submissions.rows) {
                const responseId = uuidv4();
                const mockResponse = `[AI Output for "${sub.prompt_text.substring(0, 10)}..."]\n\nHere is a creative response generated by the system. In a real environment, this would call OpenAI/Anthropic. \n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.`;

                await query(
                    `INSERT INTO llm_responses (id, prompt_submission_id, model_name, response_text) VALUES ($1, $2, 'mock-gpt-4', $3)`,
                    [responseId, sub.id, mockResponse]
                );
            }

            // 4. Broadcast Update
            const updatedBattleRes = await query(`
                SELECT b.*, c.title, c.description,
                       u1.username as player_a_username,
                       u2.username as player_b_username
                FROM battles b
                LEFT JOIN challenges c ON b.challenge_id = c.id
                LEFT JOIN users u1 ON b.player_a_id = u1.id
                LEFT JOIN users u2 ON b.player_b_id = u2.id
                WHERE b.id = $1
            `, [id]);

            const updatedBattle = updatedBattleRes.rows[0];
            req.io.to(id).emit('battle-update', updatedBattle);
        }

        res.json({ status: 'submitted' });

    } catch (err) {
        console.error('Submit error:', err);
        res.status(500).json({ error: 'Failed to submit' });
    }
});

// Cast Vote
router.post('/:id/vote', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id; // The voter
        const { choice } = req.body; // 'A', 'B', or 'TIE'

        if (!['A', 'B', 'TIE'].includes(choice)) return res.status(400).json({ error: 'Invalid choice' });

        // 1. Prevent double voting
        const existingVote = await query(
            `SELECT id FROM votes WHERE battle_id = $1 AND voter_id = $2`,
            [id, userId]
        );
        if (existingVote.rows.length > 0) {
            return res.status(400).json({ error: 'You have already voted' });
        }

        // 2. Cast Vote
        await query(
            `INSERT INTO votes (id, battle_id, voter_id, choice) VALUES ($1, $2, $3, $4)`,
            [uuidv4(), id, userId, choice]
        );

        // 3. Check if all votes are in (Assuming 2 players for now)
        // In a real app with spectators, this logic would wait for a timer or specific count.
        const voteCount = await query(`SELECT COUNT(*) as count FROM votes WHERE battle_id = $1`, [id]);

        console.log(`Battle ${id}: Votes cast so far: ${voteCount.rows[0].count}`);

        if (parseInt(voteCount.rows[0].count) >= 2) {
            console.log(`All votes received for battle ${id}. Calculating winner...`);
            // CALCULATE WINNER
            const results = await query(`
                SELECT choice, COUNT(*) as count FROM votes WHERE battle_id = $1 GROUP BY choice
             `, [id]);

            let winnerId = null;
            let votesA = 0;
            let votesB = 0;

            result = {};
            results.rows.forEach(r => {
                if (r.choice === 'A') votesA = parseInt(r.count);
                if (r.choice === 'B') votesB = parseInt(r.count);
            });

            // Get Player IDs to set winner
            const battleRes = await query(`SELECT player_a_id, player_b_id FROM battles WHERE id = $1`, [id]);
            const { player_a_id, player_b_id } = battleRes.rows[0];

            if (votesA > votesB) winnerId = player_a_id;
            else if (votesB > votesA) winnerId = player_b_id;
            // else Tie (winnerId remains null)

            // FINISH BATTLE
            await query(
                `UPDATE battles SET status = 'FINISHED', winner_id = $1, finished_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [winnerId, id]
            );

            // Update Stats (Optional, simplistic)
            if (winnerId) {
                await query(`UPDATE users SET wins = wins + 1, rating = rating + 25 WHERE id = $1`, [winnerId]);
                const loserId = winnerId === player_a_id ? player_b_id : player_a_id;
                await query(`UPDATE users SET losses = losses + 1, rating = rating - 25 WHERE id = $1`, [loserId]);
            } else {
                await query(`UPDATE users SET ties = ties + 1 WHERE id IN ($1, $2)`, [player_a_id, player_b_id]);
            }

            // Broadcast Final Update
            const finalBattleRes = await query(`
                SELECT b.*, c.title, c.description,
                       u1.username as player_a_username,
                       u2.username as player_b_username
                FROM battles b
                LEFT JOIN challenges c ON b.challenge_id = c.id
                LEFT JOIN users u1 ON b.player_a_id = u1.id
                LEFT JOIN users u2 ON b.player_b_id = u2.id
                WHERE b.id = $1
             `, [id]);

            // Fetch response text again to ensure complete object
            const finalBattle = finalBattleRes.rows[0];
            const finalResponses = await query(`
                SELECT r.response_text, r.model_name, s.user_id 
                FROM llm_responses r
                JOIN prompt_submissions s ON r.prompt_submission_id = s.id
                WHERE s.battle_id = $1
             `, [id]);
            finalBattle.responses = finalResponses.rows;

            req.io.to(id).emit('battle-update', finalBattle);
        }

        res.json({ status: 'voted' });

    } catch (err) {
        console.error('Voting error:', err);
        res.status(500).json({ error: 'Failed to vote' });
    }
});

export default router;

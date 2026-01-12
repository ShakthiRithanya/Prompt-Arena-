-- SQLite Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  rating INTEGER DEFAULT 1200,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS battles (
  id TEXT PRIMARY KEY,
  challenge_id INTEGER REFERENCES challenges(id),
  status TEXT CHECK (status IN ('WAITING', 'IN_PROGRESS', 'VOTING', 'FINISHED')) DEFAULT 'WAITING',
  player_a_id TEXT REFERENCES users(id),
  player_b_id TEXT REFERENCES users(id),
  winner_id TEXT REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS prompt_submissions (
  id TEXT PRIMARY KEY,
  battle_id TEXT REFERENCES battles(id),
  user_id TEXT REFERENCES users(id),
  prompt_text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_responses (
  id TEXT PRIMARY KEY,
  prompt_submission_id TEXT REFERENCES prompt_submissions(id),
  model_name TEXT,
  response_text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  battle_id TEXT REFERENCES battles(id),
  voter_id TEXT REFERENCES users(id),
  choice TEXT CHECK (choice IN ('A', 'B', 'TIE')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Seed Categories
INSERT OR IGNORE INTO categories (slug, name, description) VALUES
('coding', 'Coding Help', 'Generate code or explain concepts'),
('roast', 'Roast', 'Savage insults and roasts'),
('story', 'Storytelling', 'Creative writing and stories'),
('email', 'Email', 'Professional or casual emails');

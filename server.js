const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const pool = mysql.createPool({
  ...dbConfig,
  database: process.env.DB_NAME || 'helfy_app',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function ensureDatabaseExists() {
  const dbName = process.env.DB_NAME || 'helfy_app';
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  } finally {
    await connection.end();
  }
}

async function initDatabase() {
  await ensureDatabaseExists();
  const createUsersSql = `
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) UNIQUE,
      email VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `;

  const createTokensSql = `
    CREATE TABLE IF NOT EXISTS user_tokens (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      token VARCHAR(128) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `;

  const connection = await pool.getConnection();
  try {
    await connection.query(createUsersSql);
    await connection.query(createTokensSql);

    const [rows] = await connection.query('SELECT COUNT(*) AS count FROM users');
    if (rows[0].count === 0) {
      const demoPassword = 'Password123';
      const demoHash = await bcrypt.hash(demoPassword, 10);
      const kfirPassword = 'qwe123';
      const kfirHash = await bcrypt.hash(kfirPassword, 10);
      
      await connection.query(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        ['demo', 'demo@example.com', demoHash]
      );
      await connection.query(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        ['kfir', 'kfir@example.com', kfirHash]
      );
      console.log('Created default users: demo / Password123, kfir / qwe123');
    }
  } finally {
    connection.release();
  }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function getUserByCredentials(loginValue) {
  const [rows] = await pool.query(
    'SELECT id, username, email, password_hash FROM users WHERE username = ? OR email = ?',
    [loginValue, loginValue]
  );
  return rows[0];
}

async function authenticateToken(token) {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.email
     FROM user_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = ?`,
    [token]
  );
  return rows[0];
}

app.post('/api/login', async (req, res) => {
  const { username, email, password } = req.body;
  const loginValue = username || email;

  if (!loginValue || !password) {
    return res.status(400).json({ error: 'Username/email and password are required.' });
  }

  try {
    const user = await getUserByCredentials(loginValue);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = generateToken();
    await pool.query('INSERT INTO user_tokens (user_id, token) VALUES (?, ?)', [user.id, token]);

    return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unable to login at this time.' });
  }
});

app.get('/api/profile', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    return res.status(401).json({ error: 'Authorization header is required.' });
  }

  try {
    const user = await authenticateToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    return res.json({ user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Unable to fetch profile.' });
  }
});

app.post('/api/logout', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    return res.status(400).json({ error: 'Authorization header is required.' });
  }

  try {
    await pool.query('DELETE FROM user_tokens WHERE token = ?', [token]);
    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

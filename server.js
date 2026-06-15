const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const log4js = require('log4js');
const { initializeDatabase } = require('./db-init');

dotenv.config();

log4js.addLayout('structuredJson', () => (loggingEvent) => {
  const payload = loggingEvent.data.length === 1 && typeof loggingEvent.data[0] === 'object'
    ? loggingEvent.data[0]
    : { message: loggingEvent.data.join(' ') };

  return JSON.stringify({
    timestamp: payload.timestamp || loggingEvent.startTime.toISOString(),
    level: loggingEvent.level.levelStr,
    logger: loggingEvent.categoryName,
    ...payload,
  });
});

log4js.configure({
  appenders: {
    console: { type: 'console', layout: { type: 'structuredJson' } }
  },
  categories: {
    default: { appenders: ['console'], level: 'info' },
    activity: { appenders: ['console'], level: 'info' },
    cdc: { appenders: ['console'], level: 'info' }
  }
});
const activityLogger = log4js.getLogger('activity');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_NAME = process.env.DB_NAME || 'helfy_app';
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next(err);
});

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
  const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

  if (!loginValue || !password) {
    activityLogger.info({
      timestamp: new Date().toISOString(),
      action: 'login-failed',
      userId: null,
      username: loginValue,
      reason: 'Missing credentials',
      ipAddress
    });
    return res.status(400).json({ error: 'Username/email and password are required.' });
  }

  try {
    const user = await getUserByCredentials(loginValue);
    if (!user) {
      activityLogger.info({
        timestamp: new Date().toISOString(),
        action: 'login-failed',
        userId: null,
        username: loginValue,
        reason: 'User not found',
        ipAddress
      });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      activityLogger.info({
        timestamp: new Date().toISOString(),
        action: 'login-failed',
        userId: user.id,
        username: user.username,
        reason: 'Invalid password',
        ipAddress
      });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = generateToken();
    await pool.query('INSERT INTO user_tokens (user_id, token) VALUES (?, ?)', [user.id, token]);
    
    // Log successful login
    activityLogger.info({
      timestamp: new Date().toISOString(),
      action: 'login-success',
      userId: user.id,
      username: user.username,
      email: user.email,
      ipAddress
    });
    
    return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    activityLogger.error({
      timestamp: new Date().toISOString(),
      action: 'login-error',
      userId: null,
      username: loginValue,
      reason: error.message,
      ipAddress
    });
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

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function initApp() {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
  });
}

initApp().catch((err) => {
  console.error('Failed to initialize application:', err);
  process.exit(1);
});

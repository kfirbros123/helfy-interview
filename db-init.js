const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const DB_NAME = process.env.DB_NAME || 'helfy_app';
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

async function waitForTiDB() {
  let lastError;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const connection = await mysql.createConnection(DB_CONFIG);
      await connection.ping();
      await connection.end();
      return;
    } catch (err) {
      lastError = err;
      console.log(`Waiting for TiDB (${attempt}/30): ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  throw lastError;
}

async function initializeDatabase() {
  await waitForTiDB();

  const adminConnection = await mysql.createConnection(DB_CONFIG);
  await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
  await adminConnection.end();

  const connection = await mysql.createConnection({ ...DB_CONFIG, database: DB_NAME });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        token VARCHAR(128) NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await createUserIfMissing(connection, 'demo', 'demo@example.com', 'Password123');
    await createUserIfMissing(connection, 'kfir', 'kfir@example.com', 'qwe123');
  } finally {
    await connection.end();
  }
}

async function createUserIfMissing(connection, username, email, password) {
  const [rows] = await connection.query(
    'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
    [username, email]
  );

  if (rows.length > 0) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await connection.query(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email, passwordHash]
  );
}

if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('TiDB schema and default users are ready.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to initialize TiDB:', err);
      process.exit(1);
    });
}

module.exports = { initializeDatabase };

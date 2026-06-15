# Helfy App

Simple Node.js + HTML website with TiDB-backed authentication.

## Setup

1. Copy `.env.example` to `.env` and configure your TiDB connection.
2. Create the database if it does not exist:

```sql
CREATE DATABASE IF NOT EXISTS helfy_app;
```

3. For Docker Compose, TiDB is already configured as a service and the app uses `DB_HOST=tidb`.

4. Install dependencies:

```powershell
npm install
```

4. Run the app:

```powershell
npm start
```

5. Visit `http://localhost:3000`.

## Default user

The server bootstraps a demo user on startup if no users exist:

- username: `demo`
- email: `demo@example.com`
- password: `Password123`

## API

- `POST /api/login` — login with `username` or `email` and `password`
- `GET /api/profile` — requires `Authorization: Bearer <token>`

## TiDB Notes

This app uses the MySQL-compatible `mysql2` driver to connect to TiDB.

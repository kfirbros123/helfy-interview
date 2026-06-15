# Helfy App

Simple Node.js REST API, basic HTML client, TiDB storage, Kafka messaging, and TiCDC-based database change logging.

## Services

- `client`: Nginx container serving the basic login UI on `http://localhost:8080`
- `api`: Node.js/Express REST API on `http://localhost:3000`
- `db-init`: one-shot Node.js initializer that creates the TiDB schema and default users
- `pd`, `tikv`, `tidb`: TiDB cluster components
- `kafka-1`, `kafka-2`: Apache Kafka brokers
- `ticdc`: TiDB CDC server that creates the `helfy-cdc` Kafka changefeed
- `consumer`: Node.js Kafka consumer that logs database changes from the `db-changes` topic

## Run

```powershell
docker compose up --build
```

Then open:

```text
http://localhost:8080
```

## Default Users

The Docker environment automatically creates:

- username: `demo`, email: `demo@example.com`, password: `Password123`
- username: `kfir`, email: `kfir@example.com`, password: `qwe123`

## API

- `POST /api/login`
  - Body: `{ "username": "demo", "password": "Password123" }`
  - Also accepts `email` instead of `username`
  - Returns a token stored in the `user_tokens` table
- `GET /api/profile`
  - Header: `Authorization: Bearer <token>`
- `POST /api/logout`
  - Header: `Authorization: Bearer <token>`
  - Deletes the token from the database

## Logging

Login attempts are logged by the API with `log4js` in JSON format. Each login log includes:

- `timestamp`
- `userId`
- `action`
- `ipAddress`

Database inserts, updates, and deletes are captured by TiCDC, published to Kafka topic `db-changes` with `canal-json`, consumed by `consumer.js`, and logged to console with `log4js` in structured JSON format.

## Local Node Usage

If Node.js is installed locally:

```powershell
npm install
npm run db:init
npm start
```

The local app expects TiDB to be reachable with the settings in `.env`.

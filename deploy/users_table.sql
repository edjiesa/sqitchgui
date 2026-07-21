-- Deploy sqitch_demo_db:users_table to pg

BEGIN;
CREATE TABLE app.users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMIT;

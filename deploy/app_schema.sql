-- Deploy sqitch_demo_db:app_schema to pg

BEGIN;
CREATE SCHEMA IF NOT EXISTS app;
COMMIT;

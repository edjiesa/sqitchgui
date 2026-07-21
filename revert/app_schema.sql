-- Revert sqitch_demo_db:app_schema from pg

BEGIN;
DROP SCHEMA IF EXISTS app CASCADE;
COMMIT;

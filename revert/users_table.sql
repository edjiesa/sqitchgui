-- Revert sqitch_demo_db:users_table from pg

BEGIN;
DROP TABLE IF EXISTS app.users;
COMMIT;

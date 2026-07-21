-- Verify sqitch_demo_db:users_table on pg

BEGIN;
SELECT id, email FROM app.users WHERE false;
COMMIT;

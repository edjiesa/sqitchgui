-- Verify sqitch_demo_db:app_schema on pg

BEGIN;
SELECT 1/count(*) FROM information_schema.schemata WHERE schema_name = 'app';
COMMIT;

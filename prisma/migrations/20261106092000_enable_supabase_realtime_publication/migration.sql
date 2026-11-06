-- Enable Supabase Realtime (postgres_changes) on tables previously polled via Vercel API routes
DO $$
DECLARE
  tbl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY ARRAY[
      'chat_messages',
      'notifications',
      'kyc_verifications',
      'payment_attempts',
      'bulk_payments',
      'contributions',
      'fines'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      END IF;
    END LOOP;
  END IF;
END
$$;


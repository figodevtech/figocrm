DO $$
DECLARE
  name text;
  total bigint;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'profiles', 'customers', 'items', 'deals', 'deal_items', 'receivables',
    'installments', 'payments', 'settlements', 'loan_contracts',
    'subscriptions', 'billing_events'
  ] LOOP
    IF to_regclass('public.' || name) IS NULL THEN
      RAISE EXCEPTION 'missing restored table: %', name;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', name) INTO total;
    RAISE NOTICE 'restored_count %=%', name, total;
    IF name = 'profiles' AND total = 0 THEN
      RAISE EXCEPTION 'restored profiles is unexpectedly empty';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND NOT convalidated) THEN
    RAISE EXCEPTION 'one or more restored foreign keys are not validated';
  END IF;
END $$;

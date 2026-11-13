CREATE SCHEMA IF NOT EXISTS sunguard;
CREATE TABLE IF NOT EXISTS sunguard.panels (
  panel_id integer PRIMARY KEY CHECK (panel_id BETWEEN 1 AND 300)
);
CREATE TABLE IF NOT EXISTS sunguard.readings (
  panel_id integer NOT NULL REFERENCES sunguard.panels(panel_id),
  measured_at timestamptz NOT NULL,
  original_datetime timestamp without time zone NOT NULL,
  voltage numeric NOT NULL,
  current numeric NOT NULL,
  power numeric NOT NULL,
  temperature numeric NOT NULL,
  lux numeric NOT NULL,
  ambient numeric NOT NULL,
  fault text NOT NULL,
  PRIMARY KEY (panel_id, measured_at)
);
CREATE INDEX IF NOT EXISTS sunguard_readings_time_idx ON sunguard.readings(measured_at, panel_id);
INSERT INTO sunguard.panels(panel_id) SELECT generate_series(1, 300) ON CONFLICT DO NOTHING;

-- The initial integration created an empty float table; migrate only when no readings exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='sunguard' AND table_name='readings' AND column_name='power' AND data_type='double precision') THEN
    IF EXISTS (SELECT 1 FROM sunguard.readings) THEN RAISE EXCEPTION 'Cannot convert existing readings automatically'; END IF;
    ALTER TABLE sunguard.readings ALTER COLUMN voltage TYPE numeric, ALTER COLUMN current TYPE numeric, ALTER COLUMN power TYPE numeric, ALTER COLUMN temperature TYPE numeric, ALTER COLUMN lux TYPE numeric, ALTER COLUMN ambient TYPE numeric;
  END IF;
END $$;

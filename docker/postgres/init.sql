CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS verification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_url text NOT NULL,
  endpoint_domain text NOT NULL,
  model_claimed text NOT NULL,
  model_detected text,
  total_score integer,
  confidence_level text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  duration_ms integer,
  ip_hash text,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS verification_jobs_status_idx
  ON verification_jobs (status);

CREATE INDEX IF NOT EXISTS verification_jobs_endpoint_domain_idx
  ON verification_jobs (endpoint_domain);

CREATE INDEX IF NOT EXISTS verification_jobs_created_at_idx
  ON verification_jobs (created_at);

CREATE TABLE IF NOT EXISTS detection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES verification_jobs(id) ON DELETE CASCADE,
  detector_name text NOT NULL,
  score integer NOT NULL,
  max_score integer NOT NULL,
  status text NOT NULL,
  details jsonb,
  findings jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS detection_results_job_id_idx
  ON detection_results (job_id);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_domain text NOT NULL UNIQUE,
  display_name text,
  total_checks integer NOT NULL DEFAULT 0,
  avg_score numeric(5, 2),
  last_checked_at timestamp,
  models_verified jsonb,
  overall_status text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leaderboard_entries_endpoint_domain_idx
  ON leaderboard_entries (endpoint_domain);

CREATE INDEX IF NOT EXISTS leaderboard_entries_avg_score_idx
  ON leaderboard_entries (avg_score);

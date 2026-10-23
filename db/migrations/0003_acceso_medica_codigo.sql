-- Ingreso de la médica por código numérico (6 dígitos) enviado por correo.
-- Reemplaza el flujo de magic-link por uno más usable desde el celular.

CREATE TABLE doctor_access_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX doctor_access_challenges_active ON doctor_access_challenges(consumed_at) WHERE consumed_at IS NULL;
CREATE INDEX doctor_access_challenges_expiry ON doctor_access_challenges(expires_at);

CREATE TABLE doctor_access_control (
  scope TEXT PRIMARY KEY NOT NULL CHECK (scope = 'doctor'),
  next_request_at INTEGER NOT NULL
);

-- Límite por IP para frenar spam al correo de la médica.
CREATE TABLE doctor_access_ip_limit (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  last_request_at INTEGER NOT NULL
);

CREATE INDEX doctor_access_ip_limit_window ON doctor_access_ip_limit(window_start);

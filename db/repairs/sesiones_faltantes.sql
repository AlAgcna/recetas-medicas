-- Reparación puntual del esquema creado manualmente en Cloudflare.
-- Revisar antes de ejecutar: el código usa sessions, NO access_sessions.
-- No borra ni modifica access_sessions, desafíos, límites o datos clínicos.
-- No reemplaza las migraciones ni reconcilia el resto del esquema manual.
-- Definición tomada de 0001_persistencia_inicial.sql.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('doctor', 'patient')),
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((role = 'patient' AND patient_id IS NOT NULL)
      OR (role = 'doctor' AND patient_id IS NULL))
);

CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

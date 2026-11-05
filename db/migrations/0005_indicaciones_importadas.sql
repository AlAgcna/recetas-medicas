-- Historial importado: no es una publicación ni tiene estado activo.
-- Conserva el Word original en R2 privado. Fecha documental y carga son distintas.
CREATE TABLE imported_indications (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  document_date TEXT CHECK (document_date IS NULL OR document_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  imported_at INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  r2_key TEXT NOT NULL UNIQUE,
  UNIQUE (patient_id, sha256)
);
CREATE INDEX imported_indications_by_patient ON imported_indications(patient_id, document_date DESC);

-- Reparación del esquema clínico creado manualmente en Cloudflare.
--
-- Motivo: la base remota se armó con un esquema anterior y no coincide con
-- db/migrations. El alta de pacientes falla con
-- «table patients has no column named whatsapp» y el panel falla con
-- «no such column: superseded_at».
--
-- Alcance: reconstruye SÓLO las tablas clínicas vacías y declare las que
-- faltaban. No toca sessions, doctor_access_*, audit_events, access_links ni
-- access_sessions, así que el ingreso de la médica sigue funcionando.
--
-- Requisito: las tablas clínicas deben estar vacías. La primera sentencia lo
-- comprueba y aborta con «integer overflow» si hay filas; en ese caso no se
-- ejecuta ningún DROP. Es intencional: sin la guarda, volver a correr el archivo
-- borraría datos clínicos.
--
-- No reemplaza la conciliación completa del resto de tablas extra
-- (access_links, access_sessions, internal_documents, publication_files).

SELECT CASE WHEN
  (SELECT count(*) FROM patients)
  + (SELECT count(*) FROM consultations)
  + (SELECT count(*) FROM publications)
  + (SELECT count(*) FROM access_challenges) > 0
  THEN abs(-9223372036854775808) ELSE 1 END AS tablas_vacias;

DROP TABLE IF EXISTS publications;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS consultations;
DROP TABLE IF EXISTS access_challenges;
DROP TABLE IF EXISTS code_request_control;
DROP TABLE IF EXISTS patients;

CREATE TABLE patients (
  id TEXT PRIMARY KEY NOT NULL,
  -- DNI normalizado: sólo dígitos, sin puntos ni espacios. Identifica; no autentica.
  dni TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  insurance TEXT NOT NULL DEFAULT 'Particular',
  member_number TEXT NOT NULL DEFAULT '',
  -- WhatsApp en formato internacional. Deliberadamente no único.
  whatsapp TEXT NOT NULL,
  contact_verified INTEGER NOT NULL DEFAULT 0 CHECK (contact_verified IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE consultations (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  -- Raíz de la cadena de versiones. Un borrador recién creado es su propia raíz.
  chain_id TEXT NOT NULL,
  -- Fecha clínica sin hora.
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'finalized')),
  reason TEXT NOT NULL DEFAULT '',
  examination TEXT NOT NULL DEFAULT '',
  diagnosis TEXT NOT NULL DEFAULT '',
  systolic REAL,
  diastolic REAL,
  heart_rate REAL,
  respiratory_rate REAL,
  temperature REAL,
  oxygen REAL,
  weight REAL,
  height REAL,
  -- Perímetro abdominal en centímetros (migración 0004).
  abdominal_perimeter REAL,
  -- Cobertura conocida al finalizar la consulta.
  insurance_at_visit TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Versión reemplazada por una enmienda: se conserva íntegra.
  superseded_at INTEGER,
  -- Versión que esta enmienda corrige.
  supersedes_id TEXT REFERENCES consultations(id) ON DELETE RESTRICT,
  amendment_reason TEXT,
  CHECK (supersedes_id IS NULL OR status = 'finalized'),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CHECK ((supersedes_id IS NULL) = (amendment_reason IS NULL)),
  CHECK (superseded_at IS NULL OR status = 'finalized'),
  CHECK (supersedes_id IS NOT NULL OR chain_id = id)
);

-- Una sola versión vigente por cadena: el invariante de la enmienda.
CREATE UNIQUE INDEX consultations_current ON consultations(chain_id) WHERE superseded_at IS NULL;
-- Una versión no puede corregirse dos veces: la cadena no se bifurca.
CREATE UNIQUE INDEX consultations_single_successor ON consultations(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX consultations_by_patient ON consultations(patient_id, date DESC);
CREATE INDEX consultations_chain ON consultations(chain_id, updated_at);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  consultation_id TEXT REFERENCES consultations(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('prescription_pdf', 'internal')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
  -- Clave privada en R2. Nunca se entrega al navegador.
  r2_key TEXT UNIQUE,
  provenance TEXT CHECK (provenance IS NULL OR provenance IN ('uploaded', 'example')),
  created_at INTEGER NOT NULL,
  CHECK ((r2_key IS NULL) = (sha256 IS NULL)),
  CHECK (r2_key IS NULL OR (mime_type IS NOT NULL AND size_bytes IS NOT NULL AND provenance IS NOT NULL)),
  CHECK (kind <> 'prescription_pdf' OR r2_key IS NOT NULL)
);

-- Habilita la clave foránea compuesta de publications.
CREATE UNIQUE INDEX documents_owner ON documents(patient_id, id);
CREATE INDEX documents_by_patient ON documents(patient_id, created_at DESC);

CREATE TABLE publications (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('indication', 'prescription')),
  scope TEXT NOT NULL CHECK (scope IN ('general', 'patient')),
  patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Reemplazo: la versión anterior se conserva y deja de ser visible.
  superseded_at INTEGER,
  document_id TEXT,
  CHECK ((scope = 'general' AND patient_id IS NULL AND kind = 'indication')
      OR (scope = 'patient' AND patient_id IS NOT NULL)),
  CHECK ((kind = 'prescription') = (document_id IS NOT NULL)),
  CHECK (superseded_at IS NULL OR active = 0),
  CHECK (active = 0 OR superseded_at IS NULL),
  -- Coherencia de propiedad: el documento es del mismo paciente.
  FOREIGN KEY (patient_id, document_id) REFERENCES documents(patient_id, id) ON DELETE RESTRICT
);

-- Como máximo una indicación general activa.
CREATE UNIQUE INDEX publications_active_general ON publications(kind)
  WHERE scope = 'general' AND active = 1;
-- Como máximo una indicación específica activa por paciente.
CREATE UNIQUE INDEX publications_active_patient_indication ON publications(patient_id, kind)
  WHERE scope = 'patient' AND active = 1 AND kind = 'indication';
CREATE INDEX publications_by_patient ON publications(patient_id, published_at DESC);
CREATE INDEX publications_general_history ON publications(published_at DESC) WHERE scope = 'general';

CREATE TABLE access_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Verificador HMAC en hexadecimal. Nunca el código de seis dígitos.
  verifier TEXT NOT NULL CHECK (length(verifier) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at INTEGER,
  CHECK (expires_at > created_at)
);

-- Un solo desafío activo por paciente: emitir otro invalida el anterior.
CREATE UNIQUE INDEX access_challenges_active ON access_challenges(patient_id) WHERE consumed_at IS NULL;
CREATE INDEX access_challenges_expiry ON access_challenges(expires_at);

CREATE TABLE code_request_control (
  patient_id TEXT PRIMARY KEY NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  -- Próximo instante en que se permite volver a pedir un código.
  next_request_at INTEGER NOT NULL
);

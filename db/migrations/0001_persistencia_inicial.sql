-- Persistencia inicial del portal clínico (Cloudflare D1 / SQLite).
-- Revisar antes de aplicar. No importar datos reales sin autorización.
--
-- Objetivo: que la base sostenga por sí misma los invariantes que hoy sólo
-- comprueba el código en memoria, y que las operaciones críticas puedan
-- resolverse con sentencias condicionales o con `db.batch()`. D1 opera en
-- auto-commit y no permite BEGIN/COMMIT desde el Worker: `db.batch()` es la
-- transacción disponible (aborta y revierte todo si una sentencia falla).
--
-- Convenciones
--   * Identificadores internos opacos en TEXT; nunca el DNI en una URL.
--   * Instantes técnicos en INTEGER: milisegundos desde la época, en UTC.
--   * Fecha clínica como TEXT 'AAAA-MM-DD': es una fecha, no un instante.
--   * Booleanos como INTEGER 0/1.
--   * Ningún código de acceso, token ni secreto se guarda acá. De los desafíos
--     se conserva sólo el verificador (HMAC), nunca el código en claro.
--   * La aplicación debe seguir validando con Zod: la base es la última línea,
--     no la única.
--
-- Invariantes que sostiene la base:
--   * DNI único; el teléfono no es único (hay números compartidos).
--   * Una sola indicación general activa.
--   * Una sola indicación específica activa por paciente; las recetas no
--     consumen ese límite y pueden ser varias activas.
--   * Una receta nunca es general, siempre tiene documento y ese documento
--     pertenece al mismo paciente que la publicación.
--   * Una sola versión vigente por cadena de consultas y una sola enmienda por
--     versión; el reemplazo exige motivo y sólo alcanza lo finalizado.
--   * Un solo desafío de acceso activo por paciente.
--   * La sesión se identifica por el hash del token, nunca por el token.

CREATE TABLE patients (
  id TEXT PRIMARY KEY NOT NULL,
  -- DNI normalizado: sólo dígitos, sin puntos ni espacios. Identifica; no autentica.
  dni TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  insurance TEXT NOT NULL DEFAULT 'Particular',
  member_number TEXT NOT NULL DEFAULT '',
  -- WhatsApp en formato internacional. Deliberadamente no único: resolver antes
  -- la política de números compartidos, reasignados o de familiares.
  whatsapp TEXT NOT NULL,
  contact_verified INTEGER NOT NULL DEFAULT 0 CHECK (contact_verified IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE consultations (
  id TEXT PRIMARY KEY NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  -- Raíz de la cadena de versiones. Un borrador recién creado es su propia raíz.
  chain_id TEXT NOT NULL,
  -- Fecha clínica sin hora. No se inventa una hora UTC.
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
  -- Cobertura conocida al finalizar la consulta. No se recalcula desde la ficha.
  insurance_at_visit TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Versión reemplazada por una enmienda: se conserva íntegra.
  superseded_at INTEGER,
  -- Versión que esta enmienda corrige.
  supersedes_id TEXT REFERENCES consultations(id) ON DELETE RESTRICT,
  amendment_reason TEXT,
  CHECK (supersedes_id IS NULL OR status = 'finalized'),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  -- Raíz sin motivo; toda enmienda con motivo.
  CHECK ((supersedes_id IS NULL) = (amendment_reason IS NULL)),
  CHECK (superseded_at IS NULL OR status = 'finalized'),
  -- Una versión raíz conserva su propio id como identificador de cadena.
  CHECK (supersedes_id IS NOT NULL OR chain_id = id)
);

-- Una sola versión vigente por cadena: el invariante central de la enmienda.
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
  -- Clave privada en R2. Nunca se entrega al navegador: la descarga se autoriza
  -- y recién entonces el servidor lee el objeto.
  r2_key TEXT UNIQUE,
  provenance TEXT CHECK (provenance IS NULL OR provenance IN ('uploaded', 'example')),
  created_at INTEGER NOT NULL,
  -- Sin archivo, sin hash. Con archivo, metadatos completos.
  CHECK ((r2_key IS NULL) = (sha256 IS NULL)),
  CHECK (r2_key IS NULL OR (mime_type IS NOT NULL AND size_bytes IS NOT NULL AND provenance IS NOT NULL)),
  CHECK (kind <> 'prescription_pdf' OR r2_key IS NOT NULL)
);

-- Habilita la clave foránea compuesta de publications: el documento publicado
-- debe pertenecer al mismo paciente.
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
  -- La general es siempre una indicación sin destinatario; el resto tiene dueño.
  CHECK ((scope = 'general' AND patient_id IS NULL AND kind = 'indication')
      OR (scope = 'patient' AND patient_id IS NOT NULL)),
  -- Una receta existe sólo con su PDF original; una indicación no lleva archivo.
  CHECK ((kind = 'prescription') = (document_id IS NOT NULL)),
  -- Reemplazada implica inactiva; activa implica no reemplazada. Inactiva sin
  -- reemplazo queda libre para el retiro manual, todavía pendiente.
  CHECK (superseded_at IS NULL OR active = 0),
  CHECK (active = 0 OR superseded_at IS NULL),
  -- Coherencia de propiedad: el documento es del mismo paciente.
  FOREIGN KEY (patient_id, document_id) REFERENCES documents(patient_id, id) ON DELETE RESTRICT
);

-- Como máximo una indicación general activa. No alcanza con UNIQUE(patient_id):
-- en SQLite varios NULL conviven sin conflicto.
CREATE UNIQUE INDEX publications_active_general ON publications(kind)
  WHERE scope = 'general' AND active = 1;
-- Como máximo una indicación específica activa por paciente. Las recetas quedan
-- fuera del índice y pueden acumularse.
CREATE UNIQUE INDEX publications_active_patient_indication ON publications(patient_id, kind)
  WHERE scope = 'patient' AND active = 1 AND kind = 'indication';
CREATE INDEX publications_by_patient ON publications(patient_id, published_at DESC);
CREATE INDEX publications_general_history ON publications(published_at DESC) WHERE scope = 'general';

CREATE TABLE sessions (
  -- SHA-256 del valor de la cookie. El token en claro nunca se persiste.
  token_hash TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('doctor', 'patient')),
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK ((role = 'patient' AND patient_id IS NOT NULL)
      OR (role = 'doctor' AND patient_id IS NULL))
);

CREATE INDEX sessions_expiry ON sessions(expires_at);

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

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'doctor',
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX audit_events_at ON audit_events(at);

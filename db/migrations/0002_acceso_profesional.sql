-- Acceso de la médica: enlaces de ingreso enviados por correo.
--
-- No hay contraseña. La médica pide un enlace de un solo uso a su correo y con
-- ese enlace abre su sesión. De los enlaces se conserva sólo el hash SHA-256: el
-- token en claro existe únicamente en el mensaje enviado y en la URL que abre la
-- interfaz, nunca en la base, en la auditoría ni en los registros del servidor.

CREATE TABLE access_links (
  -- SHA-256 del token en hexadecimal.
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  -- Hay una sola médica: el ámbito es fijo y habilita el índice de "uno activo".
  scope TEXT NOT NULL CHECK (scope = 'doctor'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

-- Un solo enlace vigente: emitir otro invalida el anterior, igual que con los
-- códigos del paciente. Un enlace consumido deja de ocupar el lugar.
CREATE UNIQUE INDEX access_links_active ON access_links(scope) WHERE consumed_at IS NULL;
CREATE INDEX access_links_expiry ON access_links(expires_at);

CREATE TABLE access_link_control (
  scope TEXT PRIMARY KEY NOT NULL CHECK (scope = 'doctor'),
  -- Próximo instante en que se permite volver a pedir un enlace.
  next_request_at INTEGER NOT NULL
);

-- Importbatches: wat er is ingelezen, door wie, en wat er per rij mee gebeurde.
--
-- Een import verandert projecten en fasen, en dat is planning waar de hele
-- afdeling op stuurt. Zonder spoor is achteraf niet te achterhalen waarom een
-- project ineens twintig woningen groot is, en dat is precies de vraag die
-- gesteld wordt zodra de bezetting niet klopt.

CREATE TABLE import_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  soort          TEXT    NOT NULL DEFAULT 'planning'
                   CHECK (soort IN ('planning')),
  bestandsnaam   TEXT    NOT NULL,
  bestandsgrootte INTEGER NOT NULL DEFAULT 0,
  tabblad        TEXT,
  -- De kolomkoppeling zoals de gebruiker hem heeft bevestigd, als JSON.
  koppeling      TEXT    NOT NULL DEFAULT '{}',
  status         TEXT    NOT NULL DEFAULT 'voorbeeld'
                   CHECK (status IN ('voorbeeld','doorgevoerd','afgebroken')),
  rijen_totaal   INTEGER NOT NULL DEFAULT 0,
  rijen_nieuw    INTEGER NOT NULL DEFAULT 0,
  rijen_bijgewerkt INTEGER NOT NULL DEFAULT 0,
  rijen_overgeslagen INTEGER NOT NULL DEFAULT 0,
  rijen_fout     INTEGER NOT NULL DEFAULT 0,
  melding        TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id),
  committed_at   TEXT
);

CREATE INDEX idx_import_batches_created ON import_batches(created_at DESC);

CREATE TABLE import_rows (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  -- Het rijnummer uit het bronbestand, zodat een melding naar een regel in
  -- Excel verwijst en niet naar een intern volgnummer.
  bronregel     INTEGER NOT NULL,
  oordeel       TEXT    NOT NULL
                  CHECK (oordeel IN ('nieuw','bijwerken','ongewijzigd','fout')),
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- De rij zoals hij uit het bestand kwam, en wat de import ervan maakte.
  ruw           TEXT    NOT NULL DEFAULT '{}',
  waarden       TEXT    NOT NULL DEFAULT '{}',
  meldingen     TEXT    NOT NULL DEFAULT '[]',
  doorgevoerd   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_import_rows_batch ON import_rows(batch_id, bronregel);

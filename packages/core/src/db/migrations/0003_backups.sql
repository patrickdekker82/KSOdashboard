-- Back-uploop: wat er wanneer is weggeschreven, en of het lukte.
--
-- Zonder dit spoor is de signaleringsregel "back-up mislukt" niet in te vullen,
-- en dat is precies de regel die je nodig hebt op de ochtend dat de database
-- stuk is. Een back-up die er niet is, is pas een probleem als je hem nodig
-- hebt; dan wil je al een week eerder gewaarschuwd zijn.

CREATE TABLE backup_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  soort        TEXT    NOT NULL DEFAULT 'handmatig'
                 CHECK (soort IN ('handmatig', 'automatisch', 'voor_migratie', 'voor_herstel')),
  bestandsnaam TEXT,
  -- Waar het bestand heen ging. Bij een back-up naar een netwerkschijf staat
  -- hier het volledige pad, zodat je later kunt zien of dat nog klopt.
  pad          TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,
  duur_ms      INTEGER,
  status       TEXT    NOT NULL DEFAULT 'ok'
                 CHECK (status IN ('ok', 'fout')),
  fout         TEXT,
  -- Hoeveel oude back-ups er bij deze loop zijn opgeruimd.
  opgeruimd    INTEGER NOT NULL DEFAULT 0,
  gestart_door INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_backup_runs_created ON backup_runs(created_at DESC);
CREATE INDEX idx_backup_runs_status ON backup_runs(status, created_at DESC);

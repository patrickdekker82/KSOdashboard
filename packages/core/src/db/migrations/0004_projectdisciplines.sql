-- Welke productdisciplines er in een project zitten.
--
-- Kansen kenden de disciplines al via `opportunity_lines`: daar hangt per
-- discipline een bedrag en een marge aan. Een project had die koppeling niet,
-- terwijl juist daar de vraag speelt welke disciplines meelopen — badkamer,
-- keuken, tegelwerk — en wie daarvoor gebeld moet worden.
--
-- Veel-op-veel, en niet één discipline per project: een woning met een
-- badkamer én een keuken is de gewone situatie, niet de uitzondering. Een
-- kolom `discipline_id` op `projects` had die eerste week gewerkt en daarna
-- gewrongen.

CREATE TABLE project_disciplines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  discipline_id INTEGER NOT NULL REFERENCES disciplines(id),
  -- Ruimte voor wat er bij déze combinatie hoort: "alleen bouwnummer 1 t/m 20",
  -- "showroom via de leverancier". Vrije tekst, want elk project verzint hier
  -- iets eigens.
  note          TEXT,
  custom_fields TEXT    NOT NULL DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id),
  updated_by    INTEGER REFERENCES users(id),
  archived_at   TEXT,

  -- Dezelfde discipline twee keer aan één project hangen is geen keuze maar
  -- een vergissing; de database weigert het.
  UNIQUE (project_id, discipline_id)
);

CREATE INDEX idx_project_disciplines_project ON project_disciplines(project_id);
CREATE INDEX idx_project_disciplines_discipline ON project_disciplines(discipline_id);

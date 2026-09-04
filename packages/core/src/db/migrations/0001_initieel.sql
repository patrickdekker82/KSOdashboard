-- Migratie 0001 — initieel schema (hoofdstuk 4).
--
-- Conventies:
--   * id            INTEGER PRIMARY KEY AUTOINCREMENT
--   * datums        TEXT, ISO-8601 (jjjj-mm-dd of volledige tijdstempel)
--   * bedragen      INTEGER in eurocenten, nooit een float
--   * percentages   INTEGER in basispunten (0..10000)
--   * custom_fields TEXT met JSON, standaard '{}'
--   * archived_at   soft delete; NULL betekent actief

-- ===========================================================================
-- Gebruikers, roosters en beveiliging (4.1)
-- ===========================================================================

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  initials            TEXT    NOT NULL,
  email               TEXT    NOT NULL UNIQUE,
  password_hash       TEXT    NOT NULL,
  role                TEXT    NOT NULL DEFAULT 'user'
                        CHECK (role IN ('admin','manager','user','readonly')),
  color               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  is_kopersbegeleider INTEGER NOT NULL DEFAULT 0,
  last_login_at       TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  windows_account     TEXT,
  custom_fields       TEXT    NOT NULL DEFAULT '{}',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by          INTEGER REFERENCES users(id),
  updated_by          INTEGER REFERENCES users(id),
  archived_at         TEXT
);
CREATE INDEX idx_users_active ON users(active, archived_at);

CREATE TABLE work_schedules (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valid_from           TEXT    NOT NULL,
  valid_to             TEXT,               -- NULL = open einde
  mon_hours            REAL    NOT NULL DEFAULT 0,
  tue_hours            REAL    NOT NULL DEFAULT 0,
  wed_hours            REAL    NOT NULL DEFAULT 0,
  thu_hours            REAL    NOT NULL DEFAULT 0,
  fri_hours            REAL    NOT NULL DEFAULT 0,
  sat_hours            REAL    NOT NULL DEFAULT 0,
  sun_hours            REAL    NOT NULL DEFAULT 0,
  appointments_per_week REAL   NOT NULL DEFAULT 0,
  note                 TEXT,
  custom_fields        TEXT    NOT NULL DEFAULT '{}',
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by           INTEGER REFERENCES users(id),
  updated_by           INTEGER REFERENCES users(id),
  archived_at          TEXT
);
CREATE INDEX idx_work_schedules_user ON work_schedules(user_id, valid_from);

CREATE TABLE sessions (
  id          TEXT    PRIMARY KEY,          -- hash van het token, nooit het token zelf
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  entity_key TEXT    NOT NULL,
  record_id  INTEGER,
  action     TEXT    NOT NULL,
  before     TEXT,
  after      TEXT,
  at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity_key, record_id);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,               -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE secrets (
  key        TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- Configureerbaarheid: veldenregister, keuzelijsten, layouts (hoofdstuk 3)
-- ===========================================================================

CREATE TABLE picklists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE picklist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  picklist_id INTEGER NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  value       TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  metadata    TEXT    NOT NULL DEFAULT '{}',
  archived_at TEXT
);
CREATE UNIQUE INDEX idx_picklist_items_value ON picklist_items(picklist_id, value);

CREATE TABLE layout_sections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key   TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  columns      INTEGER NOT NULL DEFAULT 2 CHECK (columns BETWEEN 1 AND 3),
  collapsible  INTEGER NOT NULL DEFAULT 1,
  default_open INTEGER NOT NULL DEFAULT 1,
  archived_at  TEXT
);
CREATE INDEX idx_layout_sections_entity ON layout_sections(entity_key, sort_order);

CREATE TABLE field_definitions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key       TEXT    NOT NULL,
  field_key        TEXT    NOT NULL,
  label            TEXT    NOT NULL,
  help_text        TEXT,
  type             TEXT    NOT NULL,
  storage          TEXT    NOT NULL DEFAULT 'json'
                     CHECK (storage IN ('column','json')),
  is_system        INTEGER NOT NULL DEFAULT 0,
  is_locked        INTEGER NOT NULL DEFAULT 0,
  required         INTEGER NOT NULL DEFAULT 0,
  unique_value     INTEGER NOT NULL DEFAULT 0,
  default_value    TEXT,
  options_source   TEXT    CHECK (options_source IN ('static','picklist','entity')),
  picklist_id      INTEGER REFERENCES picklists(id),
  relation_entity  TEXT,
  validation       TEXT    NOT NULL DEFAULT '{}',
  indexed          INTEGER NOT NULL DEFAULT 0,
  section_id       INTEGER REFERENCES layout_sections(id),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  column_width     INTEGER,
  visible_in_list  INTEGER NOT NULL DEFAULT 1,
  visible_in_detail INTEGER NOT NULL DEFAULT 1,
  editable         INTEGER NOT NULL DEFAULT 1,
  archived_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER REFERENCES users(id),
  updated_by       INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_field_definitions_key ON field_definitions(entity_key, field_key);

CREATE TABLE saved_views (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key    TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  is_shared     INTEGER NOT NULL DEFAULT 0,
  is_default    INTEGER NOT NULL DEFAULT 0,
  columns       TEXT    NOT NULL DEFAULT '[]',
  filters       TEXT    NOT NULL DEFAULT '{}',
  sort          TEXT    NOT NULL DEFAULT '[]',
  group_by      TEXT,
  page_size     INTEGER NOT NULL DEFAULT 50,
  layout        TEXT    NOT NULL DEFAULT 'table'
                  CHECK (layout IN ('table','kanban','calendar','timeline')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT
);
CREATE INDEX idx_saved_views_entity ON saved_views(entity_key);

-- ===========================================================================
-- Verlof, afwezigheid en inzet elders (4.2)
--
-- Verlof en inzet elders zijn bewust twee tabellen. Verlof is afwezig zijn:
-- het telt mee in een verlofsaldo, kent een goedkeuringsstroom en is een
-- HR-begrip. Inzet elders is aanwezig maar niet beschikbaar voor de showroom:
-- het heeft een percentage, een project en een looptijd. In de
-- capaciteitsberekening gaan ze van dezelfde beschikbare tijd af; hoofdstuk
-- 7.2 stap 6 voorkomt dat ze dubbel tellen.
-- ===========================================================================

CREATE TABLE absence_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  code              TEXT    NOT NULL UNIQUE,
  color             TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  reduces_capacity  INTEGER NOT NULL DEFAULT 1,
  counts_as_leave   INTEGER NOT NULL DEFAULT 1,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  allow_half_days   INTEGER NOT NULL DEFAULT 1,
  -- Wie het type mag zien. Bij 'management' toont de UI aan collega's alleen
  -- "Afwezig" (hoofdstuk 10, privacy rond ziekteverzuim).
  visibility        TEXT    NOT NULL DEFAULT 'iedereen'
                      CHECK (visibility IN ('iedereen','management')),
  custom_fields     TEXT    NOT NULL DEFAULT '{}',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at       TEXT
);

CREATE TABLE absences (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  absence_type_id INTEGER NOT NULL REFERENCES absence_types(id),
  start_date      TEXT    NOT NULL,
  end_date        TEXT,                    -- NULL = tot nader order (ziekmelding)
  day_part        TEXT    NOT NULL DEFAULT 'hele_dag'
                    CHECK (day_part IN ('hele_dag','ochtend','middag')),
  hours_override  REAL,                    -- fijnmazig, in plaats van een dagdeel
  status          TEXT    NOT NULL DEFAULT 'aangevraagd'
                    CHECK (status IN ('aangevraagd','goedgekeurd','afgewezen','geannuleerd')),
  requested_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  requested_by    INTEGER REFERENCES users(id),
  decided_by      INTEGER REFERENCES users(id),
  decided_at      TEXT,
  decision_note   TEXT,
  note            TEXT,
  external_ref    TEXT,                    -- bijv. een Outlook-agenda-id
  custom_fields   TEXT    NOT NULL DEFAULT '{}',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by      INTEGER REFERENCES users(id),
  updated_by      INTEGER REFERENCES users(id),
  archived_at     TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX idx_absences_user_period ON absences(user_id, start_date, end_date);
CREATE INDEX idx_absences_status ON absences(status);
CREATE UNIQUE INDEX idx_absences_external ON absences(external_ref)
  WHERE external_ref IS NOT NULL;

CREATE TABLE leave_balances (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year                INTEGER NOT NULL,
  entitlement_hours   REAL    NOT NULL DEFAULT 0,
  carried_over_hours  REAL    NOT NULL DEFAULT 0,
  note                TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_leave_balances_user_year ON leave_balances(user_id, year);

CREATE TABLE holidays (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  date           TEXT    NOT NULL,
  is_day_off     INTEGER NOT NULL DEFAULT 1,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  year           INTEGER NOT NULL,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_holidays_date_name ON holidays(date, name);
CREATE INDEX idx_holidays_year ON holidays(year);

CREATE TABLE allocation_types (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  name                       TEXT    NOT NULL,
  code                       TEXT    NOT NULL UNIQUE,
  color                      TEXT,
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  active                     INTEGER NOT NULL DEFAULT 1,
  reduces_showroom_capacity  INTEGER NOT NULL DEFAULT 1,
  custom_fields              TEXT    NOT NULL DEFAULT '{}',
  created_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at                TEXT
);

CREATE TABLE capacity_allocations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocation_type_id    INTEGER NOT NULL REFERENCES allocation_types(id),
  title                 TEXT    NOT NULL,
  project_id            INTEGER REFERENCES projects(id),
  external_project_name TEXT,              -- als het project niet in het systeem staat
  organization_id       INTEGER REFERENCES organizations(id),
  start_date            TEXT    NOT NULL,
  end_date              TEXT    NOT NULL,
  allocation_mode       TEXT    NOT NULL DEFAULT 'percentage'
                          CHECK (allocation_mode IN ('percentage','dagen_per_week','uren_per_week')),
  allocation_value      REAL    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'gepland'
                          CHECK (status IN ('gepland','actief','afgerond','geannuleerd')),
  is_billable           INTEGER NOT NULL DEFAULT 0,
  note                  TEXT,
  color                 TEXT,
  approved_by           INTEGER REFERENCES users(id),
  approved_at           TEXT,
  custom_fields         TEXT    NOT NULL DEFAULT '{}',
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by            INTEGER REFERENCES users(id),
  updated_by            INTEGER REFERENCES users(id),
  archived_at           TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_allocations_user_period
  ON capacity_allocations(user_id, start_date, end_date);
CREATE INDEX idx_allocations_status ON capacity_allocations(status);

-- ===========================================================================
-- CRM (4.3)
-- ===========================================================================

CREATE TABLE organizations (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL,
  legal_name              TEXT,
  org_type_id             INTEGER REFERENCES picklist_items(id),
  kvk_number              TEXT,
  vat_number              TEXT,
  website                 TEXT,
  phone                   TEXT,
  email                   TEXT,
  address_street          TEXT,
  address_number          TEXT,
  address_addition        TEXT,
  postcode                TEXT,
  city                    TEXT,
  country                 TEXT DEFAULT 'NL',
  visit_address_street    TEXT,
  visit_address_number    TEXT,
  visit_address_addition  TEXT,
  visit_postcode          TEXT,
  visit_city              TEXT,
  visit_country           TEXT,
  owner_user_id           INTEGER REFERENCES users(id),
  source_id               INTEGER REFERENCES picklist_items(id),
  status_id               INTEGER REFERENCES picklist_items(id),
  rating                  INTEGER,
  description             TEXT,
  parent_organization_id  INTEGER REFERENCES organizations(id),
  custom_fields           TEXT    NOT NULL DEFAULT '{}',
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by              INTEGER REFERENCES users(id),
  updated_by              INTEGER REFERENCES users(id),
  archived_at             TEXT
);
CREATE INDEX idx_organizations_name ON organizations(name);
CREATE INDEX idx_organizations_owner ON organizations(owner_user_id);
CREATE INDEX idx_organizations_postcode ON organizations(postcode, address_number);

CREATE TABLE contacts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id    INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  salutation         TEXT,
  first_name         TEXT,
  infix              TEXT,
  last_name          TEXT    NOT NULL,
  initials           TEXT,
  job_title          TEXT,
  department         TEXT,
  email              TEXT,
  phone              TEXT,
  mobile             TEXT,
  linkedin           TEXT,
  is_primary         INTEGER NOT NULL DEFAULT 0,
  do_not_email       INTEGER NOT NULL DEFAULT 0,
  do_not_call        INTEGER NOT NULL DEFAULT 0,
  birthday           TEXT,
  notes              TEXT,
  owner_user_id      INTEGER REFERENCES users(id),
  marketing_consent  INTEGER NOT NULL DEFAULT 0,
  consent_at         TEXT,
  consent_source     TEXT,
  anonymised_at      TEXT,                 -- AVG: 6.1
  custom_fields      TEXT    NOT NULL DEFAULT '{}',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by         INTEGER REFERENCES users(id),
  updated_by         INTEGER REFERENCES users(id),
  archived_at        TEXT
);
CREATE INDEX idx_contacts_organization ON contacts(organization_id);
CREATE INDEX idx_contacts_last_name ON contacts(last_name);
CREATE INDEX idx_contacts_email ON contacts(email);

CREATE TABLE organization_contacts (
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role            TEXT,
  is_primary      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, contact_id)
);

CREATE TABLE tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  color        TEXT,
  entity_scope TEXT,
  archived_at  TEXT
);
CREATE UNIQUE INDEX idx_tags_name_scope ON tags(name, entity_scope);

CREATE TABLE taggables (
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_key TEXT    NOT NULL,
  record_id  INTEGER NOT NULL,
  PRIMARY KEY (tag_id, entity_key, record_id)
);
CREATE INDEX idx_taggables_record ON taggables(entity_key, record_id);

-- ===========================================================================
-- Kansen en disciplines (4.4)
-- ===========================================================================

CREATE TABLE pipelines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  entity_target TEXT    NOT NULL DEFAULT 'opportunities',
  is_default    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  archived_at   TEXT
);

CREATE TABLE pipeline_stages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id           INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name                  TEXT    NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  default_probability_bp INTEGER NOT NULL DEFAULT 0
                          CHECK (default_probability_bp BETWEEN 0 AND 10000),
  is_won                INTEGER NOT NULL DEFAULT 0,
  is_lost               INTEGER NOT NULL DEFAULT 0,
  rotting_days          INTEGER,
  color                 TEXT,
  archived_at           TEXT
);
CREATE INDEX idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id, sort_order);

CREATE TABLE disciplines (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT    NOT NULL UNIQUE,
  name               TEXT    NOT NULL,
  description        TEXT,
  color              TEXT,
  default_margin_bp  INTEGER NOT NULL DEFAULT 0,
  default_lead_weeks INTEGER,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 1,
  custom_fields      TEXT    NOT NULL DEFAULT '{}',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at        TEXT
);

CREATE TABLE opportunities (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  number                 TEXT    UNIQUE,
  name                   TEXT    NOT NULL,
  organization_id        INTEGER REFERENCES organizations(id),
  primary_contact_id     INTEGER REFERENCES contacts(id),
  owner_user_id          INTEGER REFERENCES users(id),
  pipeline_id            INTEGER REFERENCES pipelines(id),
  stage_id               INTEGER REFERENCES pipeline_stages(id),
  status                 TEXT    NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','won','lost')),
  probability_bp         INTEGER CHECK (probability_bp BETWEEN 0 AND 10000),
  amount_cents           INTEGER NOT NULL DEFAULT 0,   -- afgeleid uit de regels
  weighted_amount_cents  INTEGER NOT NULL DEFAULT 0,   -- afgeleid uit de regels
  won_amount_cents       INTEGER NOT NULL DEFAULT 0,
  currency               TEXT    NOT NULL DEFAULT 'EUR',
  expected_close_date    TEXT,
  actual_close_date      TEXT,
  expected_showroom_start TEXT,
  expected_showroom_end  TEXT,
  expected_units         INTEGER,
  source_id              INTEGER REFERENCES picklist_items(id),
  loss_reason_id         INTEGER REFERENCES picklist_items(id),
  loss_note              TEXT,
  competitor             TEXT,
  project_id             INTEGER REFERENCES projects(id),
  description            TEXT,
  next_step              TEXT,
  next_step_date         TEXT,
  last_activity_at       TEXT,
  stage_changed_at       TEXT,
  custom_fields          TEXT    NOT NULL DEFAULT '{}',
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by             INTEGER REFERENCES users(id),
  updated_by             INTEGER REFERENCES users(id),
  archived_at            TEXT
);
CREATE INDEX idx_opportunities_stage ON opportunities(stage_id);
CREATE INDEX idx_opportunities_owner ON opportunities(owner_user_id);
CREATE INDEX idx_opportunities_status ON opportunities(status, archived_at);
CREATE INDEX idx_opportunities_showroom ON opportunities(expected_showroom_start);

CREATE TABLE opportunity_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id    INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  discipline_id     INTEGER NOT NULL REFERENCES disciplines(id),
  description       TEXT,
  quantity          REAL    NOT NULL DEFAULT 1,
  unit              TEXT,
  unit_price_cents  INTEGER NOT NULL DEFAULT 0,
  discount_bp       INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  amount_cents      INTEGER NOT NULL DEFAULT 0,       -- afgeleid
  cost_price_cents  INTEGER NOT NULL DEFAULT 0,
  margin_cents      INTEGER NOT NULL DEFAULT 0,       -- afgeleid
  probability_bp    INTEGER CHECK (probability_bp BETWEEN 0 AND 10000),
  status            TEXT    NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','won','lost')),
  won_amount_cents  INTEGER,
  expected_start    TEXT,
  expected_end      TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  custom_fields     TEXT    NOT NULL DEFAULT '{}',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at       TEXT
);
CREATE INDEX idx_opportunity_lines_opportunity ON opportunity_lines(opportunity_id);
CREATE INDEX idx_opportunity_lines_discipline ON opportunity_lines(discipline_id);

CREATE TABLE opportunity_stage_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage_id  INTEGER REFERENCES pipeline_stages(id),
  to_stage_id    INTEGER REFERENCES pipeline_stages(id),
  at             TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id        INTEGER REFERENCES users(id),
  days_in_stage  REAL
);
CREATE INDEX idx_stage_history_opportunity ON opportunity_stage_history(opportunity_id);

-- ===========================================================================
-- Projecten en planning (4.5)
-- ===========================================================================

CREATE TABLE projects (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  number                     TEXT    UNIQUE,
  name                       TEXT    NOT NULL,
  organization_id            INTEGER REFERENCES organizations(id),
  contractor_organization_id INTEGER REFERENCES organizations(id),
  developer_organization_id  INTEGER REFERENCES organizations(id),
  opportunity_id             INTEGER REFERENCES opportunities(id),
  city                       TEXT,
  plan_name                  TEXT,
  unit_count                 INTEGER NOT NULL DEFAULT 0,
  unit_types                 TEXT    NOT NULL DEFAULT '[]',
  status_id                  INTEGER REFERENCES picklist_items(id),
  -- false = een project waar collega's wel op zitten, maar dat geen
  -- showroombelasting geeft; hieraan wordt inzet elders gekoppeld (6.4.5).
  counts_as_showroom         INTEGER NOT NULL DEFAULT 1,
  appointments_per_unit      REAL,          -- V, NULL = systeeminstelling
  lead_time_weeks            REAL,          -- D, NULL = systeeminstelling
  contract_value_cents       INTEGER NOT NULL DEFAULT 0,
  showroom_revenue_cents     INTEGER NOT NULL DEFAULT 0,
  risk_note                  TEXT,
  description                TEXT,
  color                      TEXT,
  custom_fields              TEXT    NOT NULL DEFAULT '{}',
  created_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by                 INTEGER REFERENCES users(id),
  updated_by                 INTEGER REFERENCES users(id),
  archived_at                TEXT
);
CREATE INDEX idx_projects_showroom ON projects(counts_as_showroom, archived_at);
CREATE INDEX idx_projects_city ON projects(city);

CREATE TABLE project_phases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_type_id      INTEGER NOT NULL REFERENCES picklist_items(id),
  start_date         TEXT    NOT NULL,
  end_date           TEXT    NOT NULL,
  unit_count_override INTEGER,
  note               TEXT,
  -- Alleen showroom en sluiting belasten de afdeling; start bouw en
  -- oplevering tellen niet mee als showroomcapaciteit (hoofdstuk 1).
  is_capacity_load   INTEGER NOT NULL DEFAULT 0,
  custom_fields      TEXT    NOT NULL DEFAULT '{}',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at        TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_project_phases_project ON project_phases(project_id);
CREATE INDEX idx_project_phases_period ON project_phases(start_date, end_date);

CREATE TABLE project_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'kopersbegeleider'
               CHECK (role IN ('kopersbegeleider','backup','overig')),
  share_bp   INTEGER NOT NULL DEFAULT 10000 CHECK (share_bp BETWEEN 0 AND 10000),
  start_date TEXT,
  end_date   TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX idx_project_assignments_project ON project_assignments(project_id);
CREATE INDEX idx_project_assignments_user ON project_assignments(user_id);

CREATE TABLE closure_periods (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  start_date     TEXT    NOT NULL,
  end_date       TEXT    NOT NULL,
  user_id        INTEGER REFERENCES users(id),   -- NULL = iedereen
  recurring_rule TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at    TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_closure_periods_period ON closure_periods(start_date, end_date);

CREATE TABLE capacity_overrides (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_year              INTEGER NOT NULL,
  iso_week              INTEGER NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  user_id               INTEGER REFERENCES users(id),  -- NULL = teamtotaal
  appointments_capacity REAL    NOT NULL,
  note                  TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_capacity_overrides_week
  ON capacity_overrides(iso_year, iso_week, IFNULL(user_id, 0));

-- ===========================================================================
-- Duurzaamheidspakketten (4.6)
-- ===========================================================================

CREATE TABLE product_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  color       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);

CREATE TABLE products (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                     TEXT    UNIQUE,
  name                    TEXT    NOT NULL,
  category_id             INTEGER REFERENCES product_categories(id),
  brand                   TEXT,
  model                   TEXT,
  unit                    TEXT    NOT NULL DEFAULT 'stuk',
  purchase_price_cents    INTEGER NOT NULL DEFAULT 0,
  sales_price_cents       INTEGER NOT NULL DEFAULT 0,
  vat_rate_bp             INTEGER NOT NULL DEFAULT 2100,
  supplier_organization_id INTEGER REFERENCES organizations(id),
  specs                   TEXT    NOT NULL DEFAULT '{}',
  image_path              TEXT,
  datasheet_path          TEXT,
  description             TEXT,
  active                  INTEGER NOT NULL DEFAULT 1,
  custom_fields           TEXT    NOT NULL DEFAULT '{}',
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by              INTEGER REFERENCES users(id),
  updated_by              INTEGER REFERENCES users(id),
  archived_at             TEXT
);
CREATE INDEX idx_products_category ON products(category_id, active);

CREATE TABLE packages (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  code                   TEXT    UNIQUE,
  name                   TEXT    NOT NULL,
  description            TEXT,
  category_id            INTEGER REFERENCES product_categories(id),
  image_path             TEXT,
  pricing_mode           TEXT    NOT NULL DEFAULT 'sum'
                           CHECK (pricing_mode IN ('sum','fixed','sum_with_margin')),
  fixed_price_cents      INTEGER,
  margin_bp              INTEGER NOT NULL DEFAULT 0,
  vat_mode               TEXT    NOT NULL DEFAULT 'excl' CHECK (vat_mode IN ('incl','excl')),
  valid_from             TEXT,
  valid_to               TEXT,
  active                 INTEGER NOT NULL DEFAULT 1,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  default_terms          TEXT,
  estimated_install_hours REAL,
  custom_fields          TEXT    NOT NULL DEFAULT '{}',
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by             INTEGER REFERENCES users(id),
  updated_by             INTEGER REFERENCES users(id),
  archived_at            TEXT
);

CREATE TABLE package_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id          INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id          INTEGER REFERENCES products(id),
  description         TEXT,
  quantity            REAL    NOT NULL DEFAULT 1,
  unit_price_cents    INTEGER NOT NULL DEFAULT 0,
  discount_bp         INTEGER NOT NULL DEFAULT 0,
  is_optional         INTEGER NOT NULL DEFAULT 0,
  is_quantity_variable INTEGER NOT NULL DEFAULT 0,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  category_label      TEXT,
  archived_at         TEXT
);
CREATE INDEX idx_package_items_package ON package_items(package_id, sort_order);

CREATE TABLE package_quotes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  number            TEXT    UNIQUE,
  organization_id   INTEGER REFERENCES organizations(id),
  contact_id        INTEGER REFERENCES contacts(id),
  project_id        INTEGER REFERENCES projects(id),
  opportunity_id    INTEGER REFERENCES opportunities(id),
  package_id        INTEGER REFERENCES packages(id),
  owner_user_id     INTEGER REFERENCES users(id),
  pipeline_id       INTEGER REFERENCES pipelines(id),
  stage_id          INTEGER REFERENCES pipeline_stages(id),
  status            TEXT    NOT NULL DEFAULT 'concept',
  sent_at           TEXT,
  valid_until       TEXT,
  decided_at        TEXT,
  decline_reason_id INTEGER REFERENCES picklist_items(id),
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  vat_cents         INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  follow_up_at      TEXT,
  follow_up_user_id INTEGER REFERENCES users(id),
  notes             TEXT,
  internal_notes    TEXT,
  pdf_path          TEXT,
  custom_fields     TEXT    NOT NULL DEFAULT '{}',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by        INTEGER REFERENCES users(id),
  updated_by        INTEGER REFERENCES users(id),
  archived_at       TEXT
);
CREATE INDEX idx_package_quotes_status ON package_quotes(status, archived_at);
CREATE INDEX idx_package_quotes_organization ON package_quotes(organization_id);

-- Offerteregels zijn een SNAPSHOT: latere prijswijzigingen op producten
-- raken bestaande offertes niet (hoofdstuk 4.6).
CREATE TABLE package_quote_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id         INTEGER NOT NULL REFERENCES package_quotes(id) ON DELETE CASCADE,
  product_id       INTEGER REFERENCES products(id),
  description      TEXT    NOT NULL,
  quantity         REAL    NOT NULL DEFAULT 1,
  unit             TEXT,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_bp      INTEGER NOT NULL DEFAULT 0,
  vat_rate_bp      INTEGER NOT NULL DEFAULT 2100,
  amount_cents     INTEGER NOT NULL DEFAULT 0,
  cost_price_cents INTEGER NOT NULL DEFAULT 0,
  is_optional      INTEGER NOT NULL DEFAULT 0,
  is_selected      INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_quote_lines_quote ON package_quote_lines(quote_id, sort_order);

-- ===========================================================================
-- Activiteiten en bellijsten (4.7)
-- ===========================================================================

CREATE TABLE activities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  type             TEXT    NOT NULL DEFAULT 'taak'
                     CHECK (type IN ('bellen','e-mail','afspraak','taak','notitie','whatsapp')),
  subject          TEXT    NOT NULL,
  body             TEXT,
  outcome_id       INTEGER REFERENCES picklist_items(id),
  status           TEXT    NOT NULL DEFAULT 'open',
  priority         TEXT    NOT NULL DEFAULT 'normaal',
  due_at           TEXT,
  reminder_at      TEXT,
  completed_at     TEXT,
  duration_minutes INTEGER,
  assigned_user_id INTEGER REFERENCES users(id),
  next_activity_id INTEGER REFERENCES activities(id),
  custom_fields    TEXT    NOT NULL DEFAULT '{}',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER REFERENCES users(id),
  updated_by       INTEGER REFERENCES users(id),
  archived_at      TEXT
);
CREATE INDEX idx_activities_due ON activities(due_at, status);
CREATE INDEX idx_activities_assigned ON activities(assigned_user_id, status);

CREATE TABLE activity_links (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  entity_key  TEXT    NOT NULL,
  record_id   INTEGER NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_id, entity_key, record_id)
);
CREATE INDEX idx_activity_links_record ON activity_links(entity_key, record_id);

CREATE TABLE call_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  filter        TEXT,                        -- JSON; NULL = handmatige lijst
  owner_user_id INTEGER REFERENCES users(id),
  is_shared     INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT
);

CREATE TABLE call_list_members (
  call_list_id INTEGER NOT NULL REFERENCES call_lists(id) ON DELETE CASCADE,
  entity_key   TEXT    NOT NULL,
  record_id    INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  done_at      TEXT,
  note         TEXT,
  PRIMARY KEY (call_list_id, entity_key, record_id)
);

-- ===========================================================================
-- E-mail via Microsoft 365 (4.8)
-- ===========================================================================

CREATE TABLE email_accounts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER REFERENCES users(id) ON DELETE CASCADE,
  provider              TEXT    NOT NULL DEFAULT 'graph',
  from_address          TEXT    NOT NULL,
  display_name          TEXT,
  is_default            INTEGER NOT NULL DEFAULT 0,
  graph_tenant_id       TEXT,
  graph_client_id       TEXT,
  graph_token_ref       TEXT REFERENCES secrets(key),
  scopes                TEXT    NOT NULL DEFAULT '[]',
  signature_html        TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  last_token_refresh_at TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at           TEXT
);

CREATE TABLE email_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  code         TEXT    UNIQUE,
  category_id  INTEGER REFERENCES picklist_items(id),
  subject      TEXT    NOT NULL,
  body_html    TEXT    NOT NULL,
  body_text    TEXT,
  language     TEXT    NOT NULL DEFAULT 'nl',
  variables    TEXT    NOT NULL DEFAULT '[]',
  attachments  TEXT    NOT NULL DEFAULT '[]',
  entity_scope TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id),
  updated_by   INTEGER REFERENCES users(id),
  archived_at  TEXT
);

CREATE TABLE email_template_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  subject     TEXT    NOT NULL,
  body_html   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by  INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_template_versions ON email_template_versions(template_id, version);

CREATE TABLE email_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id          INTEGER REFERENCES email_accounts(id),
  template_id         INTEGER REFERENCES email_templates(id),
  direction           TEXT    NOT NULL DEFAULT 'uitgaand',
  to_json             TEXT    NOT NULL DEFAULT '[]',
  cc_json             TEXT    NOT NULL DEFAULT '[]',
  bcc_json            TEXT    NOT NULL DEFAULT '[]',
  subject             TEXT    NOT NULL,
  body_html           TEXT,
  body_text           TEXT,
  status              TEXT    NOT NULL DEFAULT 'wachtrij',
  attempts            INTEGER NOT NULL DEFAULT 0,
  queued_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  next_attempt_at     TEXT,
  sent_at             TEXT,
  error               TEXT,
  provider_message_id TEXT,
  attachments         TEXT    NOT NULL DEFAULT '[]',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by          INTEGER REFERENCES users(id)
);
CREATE INDEX idx_email_messages_status ON email_messages(status, next_attempt_at);

CREATE TABLE email_message_links (
  message_id INTEGER NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  entity_key TEXT    NOT NULL,
  record_id  INTEGER NOT NULL,
  PRIMARY KEY (message_id, entity_key, record_id)
);
CREATE INDEX idx_email_links_record ON email_message_links(entity_key, record_id);

-- ===========================================================================
-- AI-assistent (4.9)
-- ===========================================================================

CREATE TABLE ai_presets (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL,
  description             TEXT,
  category                TEXT,
  system_prompt           TEXT    NOT NULL DEFAULT '',
  user_prompt_template    TEXT    NOT NULL DEFAULT '',
  model                   TEXT    NOT NULL DEFAULT 'claude-opus-5',
  max_tokens              INTEGER NOT NULL DEFAULT 2048,
  include_context         TEXT    NOT NULL DEFAULT '[]',
  -- Vervangt namen, adressen en e-mailadressen door plaatshouders voordat er
  -- iets naar de API gaat, en zet ze in het antwoord weer terug (hoofdstuk 6.8).
  anonymise_personal_data INTEGER NOT NULL DEFAULT 1,
  output_target           TEXT,
  active                  INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at             TEXT
);

CREATE TABLE ai_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id           INTEGER REFERENCES ai_presets(id),
  user_id             INTEGER REFERENCES users(id),
  model               TEXT    NOT NULL,
  prompt_summary      TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cost_estimate_cents INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER,
  status              TEXT    NOT NULL DEFAULT 'ok',
  error               TEXT,
  entity_key          TEXT,
  record_id           INTEGER,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_runs_created ON ai_runs(created_at);

-- ===========================================================================
-- Rapportage, signalering en overig (4.10)
-- ===========================================================================

CREATE TABLE saved_queries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  mode          TEXT    NOT NULL DEFAULT 'builder' CHECK (mode IN ('builder','sql')),
  builder       TEXT,
  sql           TEXT,
  parameters    TEXT    NOT NULL DEFAULT '{}',
  chart_config  TEXT    NOT NULL DEFAULT '{}',
  owner_user_id INTEGER REFERENCES users(id),
  is_shared     INTEGER NOT NULL DEFAULT 0,
  last_run_at   TEXT,
  last_run_ms   INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT
);

CREATE TABLE report_definitions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  saved_query_id  INTEGER REFERENCES saved_queries(id),
  template_type   TEXT    NOT NULL DEFAULT 'pdf',
  template_path   TEXT,
  header          TEXT    NOT NULL DEFAULT '{}',
  footer          TEXT    NOT NULL DEFAULT '{}',
  schedule_cron   TEXT,
  recipients      TEXT    NOT NULL DEFAULT '[]',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT
);

CREATE TABLE alert_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  type            TEXT    NOT NULL,
  params          TEXT    NOT NULL DEFAULT '{}',
  severity        TEXT    NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','let_op','urgent')),
  active          INTEGER NOT NULL DEFAULT 1,
  recipients      TEXT    NOT NULL DEFAULT '[]',
  check_cron      TEXT,
  last_checked_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT
);

CREATE TABLE alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id         INTEGER REFERENCES alert_rules(id) ON DELETE CASCADE,
  title           TEXT    NOT NULL,
  body            TEXT,
  severity        TEXT    NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','let_op','urgent')),
  entity_key      TEXT,
  record_id       INTEGER,
  status          TEXT    NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','bevestigd','uitgesteld','opgelost')),
  first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  snoozed_until   TEXT,
  -- Voorkomt dat een uurlijkse controle dezelfde melding blijft herhalen.
  dedupe_key      TEXT    NOT NULL,
  payload         TEXT    NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX idx_alerts_dedupe ON alerts(dedupe_key);
CREATE INDEX idx_alerts_status ON alerts(status, severity);

CREATE TABLE attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key  TEXT    NOT NULL,
  record_id   INTEGER NOT NULL,
  filename    TEXT    NOT NULL,
  stored_path TEXT    NOT NULL,
  mime        TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')),
  description TEXT,
  archived_at TEXT
);
CREATE INDEX idx_attachments_record ON attachments(entity_key, record_id);

CREATE TABLE number_sequences (
  key          TEXT    PRIMARY KEY,
  prefix       TEXT    NOT NULL DEFAULT '',
  next_value   INTEGER NOT NULL DEFAULT 1,
  padding      INTEGER NOT NULL DEFAULT 4,
  reset_period TEXT    NOT NULL DEFAULT 'nooit'
                 CHECK (reset_period IN ('nooit','jaar','maand')),
  last_reset   TEXT
);

CREATE TABLE import_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key  TEXT    NOT NULL,
  filename    TEXT    NOT NULL,
  mapping     TEXT    NOT NULL DEFAULT '{}',
  status      TEXT    NOT NULL DEFAULT 'nieuw',
  total_rows  INTEGER NOT NULL DEFAULT 0,
  ok_rows     INTEGER NOT NULL DEFAULT 0,
  error_rows  INTEGER NOT NULL DEFAULT 0,
  errors      TEXT    NOT NULL DEFAULT '[]',
  dry_run     INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

-- ===========================================================================
-- Zoeken (FTS5) — hoofdstuk 6.1
-- ===========================================================================

CREATE VIRTUAL TABLE organizations_fts USING fts5(
  name, city, kvk_number, email, phone, description,
  content = 'organizations',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER organizations_fts_insert AFTER INSERT ON organizations BEGIN
  INSERT INTO organizations_fts(rowid, name, city, kvk_number, email, phone, description)
  VALUES (new.id, new.name, new.city, new.kvk_number, new.email, new.phone, new.description);
END;
CREATE TRIGGER organizations_fts_delete AFTER DELETE ON organizations BEGIN
  INSERT INTO organizations_fts(organizations_fts, rowid, name, city, kvk_number, email, phone, description)
  VALUES ('delete', old.id, old.name, old.city, old.kvk_number, old.email, old.phone, old.description);
END;
CREATE TRIGGER organizations_fts_update AFTER UPDATE ON organizations BEGIN
  INSERT INTO organizations_fts(organizations_fts, rowid, name, city, kvk_number, email, phone, description)
  VALUES ('delete', old.id, old.name, old.city, old.kvk_number, old.email, old.phone, old.description);
  INSERT INTO organizations_fts(rowid, name, city, kvk_number, email, phone, description)
  VALUES (new.id, new.name, new.city, new.kvk_number, new.email, new.phone, new.description);
END;

CREATE VIRTUAL TABLE contacts_fts USING fts5(
  first_name, infix, last_name, email, phone, mobile, job_title, notes,
  content = 'contacts',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER contacts_fts_insert AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_fts(rowid, first_name, infix, last_name, email, phone, mobile, job_title, notes)
  VALUES (new.id, new.first_name, new.infix, new.last_name, new.email, new.phone, new.mobile, new.job_title, new.notes);
END;
CREATE TRIGGER contacts_fts_delete AFTER DELETE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, first_name, infix, last_name, email, phone, mobile, job_title, notes)
  VALUES ('delete', old.id, old.first_name, old.infix, old.last_name, old.email, old.phone, old.mobile, old.job_title, old.notes);
END;
CREATE TRIGGER contacts_fts_update AFTER UPDATE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, first_name, infix, last_name, email, phone, mobile, job_title, notes)
  VALUES ('delete', old.id, old.first_name, old.infix, old.last_name, old.email, old.phone, old.mobile, old.job_title, old.notes);
  INSERT INTO contacts_fts(rowid, first_name, infix, last_name, email, phone, mobile, job_title, notes)
  VALUES (new.id, new.first_name, new.infix, new.last_name, new.email, new.phone, new.mobile, new.job_title, new.notes);
END;

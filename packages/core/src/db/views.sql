-- Rapportage-views (4.11).
--
-- Deze views zijn de basis voor de query-bouwer en de exports. Ze staan
-- bewust apart van de migraties: ze bevatten geen data, dus ze worden bij
-- elke start opnieuw aangemaakt en mogen vrij wijzigen.

DROP VIEW IF EXISTS v_organisaties;
CREATE VIEW v_organisaties AS
SELECT o.id                    AS id,
       o.name                  AS naam,
       o.city                  AS plaats,
       o.postcode              AS postcode,
       o.kvk_number            AS kvk_nummer,
       o.email                 AS email,
       o.phone                 AS telefoon,
       u.name                  AS eigenaar,
       (SELECT COUNT(*) FROM contacts c
         WHERE c.organization_id = o.id AND c.archived_at IS NULL) AS aantal_contactpersonen,
       o.created_at            AS aangemaakt_op
FROM organizations o
LEFT JOIN users u ON u.id = o.owner_user_id
WHERE o.archived_at IS NULL;

DROP VIEW IF EXISTS v_contactpersonen;
CREATE VIEW v_contactpersonen AS
SELECT c.id AS id,
       TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.infix, '') || ' ' || c.last_name)
                               AS volledige_naam,
       c.email                 AS email,
       c.phone                 AS telefoon,
       c.mobile                AS mobiel,
       c.job_title             AS functie,
       o.name                  AS organisatie,
       c.do_not_email          AS niet_mailen,
       c.do_not_call           AS niet_bellen,
       c.created_at            AS aangemaakt_op
FROM contacts c
LEFT JOIN organizations o ON o.id = c.organization_id
WHERE c.archived_at IS NULL;

DROP VIEW IF EXISTS v_kansen;
CREATE VIEW v_kansen AS
SELECT k.id                      AS id,
       k.number                  AS nummer,
       k.name                    AS naam,
       o.name                    AS organisatie,
       s.name                    AS fase,
       k.status                  AS status,
       k.probability_bp / 100.0  AS kans_pct,
       k.amount_cents / 100.0    AS bedrag,
       k.weighted_amount_cents / 100.0 AS gewogen_bedrag,
       k.won_amount_cents / 100.0      AS gescoord_bedrag,
       u.name                    AS eigenaar,
       k.expected_close_date     AS verwachte_sluitdatum,
       k.expected_showroom_start AS verwachte_showroomstart,
       k.expected_units          AS verwacht_aantal_woningen,
       k.last_activity_at        AS laatste_activiteit
FROM opportunities k
LEFT JOIN organizations o ON o.id = k.organization_id
LEFT JOIN pipeline_stages s ON s.id = k.stage_id
LEFT JOIN users u ON u.id = k.owner_user_id
WHERE k.archived_at IS NULL;

DROP VIEW IF EXISTS v_kansregels;
CREATE VIEW v_kansregels AS
SELECT r.id                     AS id,
       k.number                 AS kansnummer,
       k.name                   AS kans,
       d.name                   AS discipline,
       r.quantity               AS aantal,
       r.unit_price_cents / 100.0 AS eenheidsprijs,
       r.discount_bp / 100.0    AS korting_pct,
       r.amount_cents / 100.0   AS bedrag,
       r.margin_cents / 100.0   AS marge,
       r.status                 AS status,
       r.expected_start         AS verwachte_start
FROM opportunity_lines r
JOIN opportunities k ON k.id = r.opportunity_id
JOIN disciplines d ON d.id = r.discipline_id
WHERE r.archived_at IS NULL;

DROP VIEW IF EXISTS v_projecten;
CREATE VIEW v_projecten AS
SELECT p.id                  AS id,
       p.number              AS nummer,
       p.name                AS naam,
       p.plan_name           AS plannaam,
       p.city                AS plaats,
       p.unit_count          AS aantal_woningen,
       o.name                AS aannemer,
       p.counts_as_showroom  AS telt_als_showroom,
       (SELECT GROUP_CONCAT(u.initials, '/')
          FROM project_assignments a
          JOIN users u ON u.id = a.user_id
         WHERE a.project_id = p.id AND a.archived_at IS NULL) AS begeleiders,
       (SELECT MIN(f.start_date) FROM project_phases f
         WHERE f.project_id = p.id AND f.is_capacity_load = 1) AS showroom_start,
       (SELECT MAX(f.end_date) FROM project_phases f
         WHERE f.project_id = p.id AND f.is_capacity_load = 1) AS showroom_eind
FROM projects p
LEFT JOIN organizations o ON o.id = p.contractor_organization_id
WHERE p.archived_at IS NULL;

-- Afwezigheid en inzet elders samengevoegd, met een kolom `soort` (4.11).
DROP VIEW IF EXISTS v_afwezigheid;
CREATE VIEW v_afwezigheid AS
SELECT 'verlof'        AS soort,
       a.id            AS id,
       u.initials      AS initialen,
       u.name          AS medewerker,
       t.name          AS type,
       t.color         AS kleur,
       a.start_date    AS start_datum,
       a.end_date      AS eind_datum,
       a.day_part      AS dagdeel,
       a.status        AS status,
       NULL            AS omvang,
       a.note          AS notitie
FROM absences a
JOIN users u ON u.id = a.user_id
JOIN absence_types t ON t.id = a.absence_type_id
WHERE a.archived_at IS NULL
UNION ALL
SELECT 'inzet_elders'  AS soort,
       c.id            AS id,
       u.initials      AS initialen,
       u.name          AS medewerker,
       t.name          AS type,
       COALESCE(c.color, t.color) AS kleur,
       c.start_date    AS start_datum,
       c.end_date      AS eind_datum,
       NULL            AS dagdeel,
       c.status        AS status,
       c.allocation_value || ' ' || c.allocation_mode AS omvang,
       c.title         AS notitie
FROM capacity_allocations c
JOIN users u ON u.id = c.user_id
JOIN allocation_types t ON t.id = c.allocation_type_id
WHERE c.archived_at IS NULL;

DROP VIEW IF EXISTS v_offertes;
CREATE VIEW v_offertes AS
SELECT q.id                  AS id,
       q.number              AS nummer,
       o.name                AS organisatie,
       pk.name               AS pakket,
       q.status              AS status,
       q.total_cents / 100.0 AS totaal,
       q.sent_at             AS verstuurd_op,
       q.valid_until         AS geldig_tot,
       q.follow_up_at        AS opvolgen_op,
       u.name                AS eigenaar
FROM package_quotes q
LEFT JOIN organizations o ON o.id = q.organization_id
LEFT JOIN packages pk ON pk.id = q.package_id
LEFT JOIN users u ON u.id = q.owner_user_id
WHERE q.archived_at IS NULL;

DROP VIEW IF EXISTS v_offerteregels;
CREATE VIEW v_offerteregels AS
SELECT r.id                       AS id,
       q.number                   AS offertenummer,
       r.description              AS omschrijving,
       r.quantity                 AS aantal,
       r.unit_price_cents / 100.0 AS eenheidsprijs,
       r.amount_cents / 100.0     AS bedrag,
       r.vat_rate_bp / 100.0      AS btw_pct,
       r.is_optional              AS optioneel,
       r.is_selected              AS gekozen
FROM package_quote_lines r
JOIN package_quotes q ON q.id = r.quote_id;

DROP VIEW IF EXISTS v_activiteiten;
CREATE VIEW v_activiteiten AS
SELECT a.id           AS id,
       a.type         AS soort,
       a.subject      AS onderwerp,
       a.status       AS status,
       a.due_at       AS vervalt_op,
       a.completed_at AS afgerond_op,
       u.name         AS toegewezen_aan
FROM activities a
LEFT JOIN users u ON u.id = a.assigned_user_id
WHERE a.archived_at IS NULL;

DROP VIEW IF EXISTS v_omzet_per_discipline_maand;
CREATE VIEW v_omzet_per_discipline_maand AS
SELECT d.name                              AS discipline,
       SUBSTR(k.actual_close_date, 1, 7)   AS maand,
       COUNT(*)                            AS aantal_regels,
       SUM(COALESCE(r.won_amount_cents, r.amount_cents)) / 100.0 AS gescoorde_omzet
FROM opportunity_lines r
JOIN opportunities k ON k.id = r.opportunity_id
JOIN disciplines d ON d.id = r.discipline_id
WHERE r.status = 'won' AND k.actual_close_date IS NOT NULL
GROUP BY d.name, SUBSTR(k.actual_close_date, 1, 7);

DROP VIEW IF EXISTS v_pipeline_per_fase;
CREATE VIEW v_pipeline_per_fase AS
SELECT s.name                          AS fase,
       s.sort_order                    AS volgorde,
       COUNT(k.id)                     AS aantal_kansen,
       SUM(k.amount_cents) / 100.0     AS bedrag,
       SUM(k.weighted_amount_cents) / 100.0 AS gewogen_bedrag
FROM pipeline_stages s
LEFT JOIN opportunities k
       ON k.stage_id = s.id AND k.status = 'open' AND k.archived_at IS NULL
WHERE s.archived_at IS NULL
GROUP BY s.id, s.name, s.sort_order;

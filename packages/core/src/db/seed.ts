/**
 * Seed data — bijlage A.
 *
 * `seedBase` fills everything the app needs to be usable: users, schedules,
 * absence and allocation types, holidays, disciplines, pipelines, settings.
 * `seedDemo` adds a realistic showroom year on top, chosen so that every
 * dashboard widget and every alert rule from 8.2 actually has something to show.
 *
 * All dates are anchored to a reference date so the result is deterministic in
 * tests and always relevant when a colleague opens the app.
 */
import {
  addDays,
  addIsoWeeks,
  DEFAULT_APPOINTMENTS_PER_UNIT,
  DEFAULT_CAPACITY_SETTINGS,
  DEFAULT_LEAD_TIME_WEEKS,
  getIsoWeek,
  isoWeekStart,
  toIsoDate,
  type IsoWeek,
} from '@showroom/shared';
import { generateHolidays } from '../modules/availability/holidays.ts';
import { hashPassword } from '../modules/auth/password.ts';
import type { DatabaseHandle } from './client.ts';

export const DEMO_PASSWORD = 'Showroom2026!';

type SeedOptions = {
  /** Anchor for every relative date. Defaults to today. */
  referenceDate?: Date;
  demo?: boolean;
};

/** Monday of the ISO week `offset` weeks from the reference week. */
function weekStart(reference: IsoWeek, offset: number): string {
  return toIsoDate(isoWeekStart(addIsoWeeks(reference, offset)));
}

/** Sunday of the ISO week `offset` weeks from the reference week. */
function weekEnd(reference: IsoWeek, offset: number): string {
  return toIsoDate(addDays(isoWeekStart(addIsoWeeks(reference, offset)), 6));
}

/** Friday of the ISO week `offset` weeks from the reference week. */
function weekDay(reference: IsoWeek, offset: number, weekday: number): string {
  return toIsoDate(addDays(isoWeekStart(addIsoWeeks(reference, offset)), weekday - 1));
}

export async function seed(handle: DatabaseHandle, options: SeedOptions = {}): Promise<void> {
  const reference = getIsoWeek(options.referenceDate ?? new Date());
  await seedBase(handle, reference);
  if (options.demo) seedDemo(handle, reference);
}

// ---------------------------------------------------------------------------
// Basis
// ---------------------------------------------------------------------------

export async function seedBase(handle: DatabaseHandle, reference: IsoWeek): Promise<void> {
  const { raw } = handle;
  const run = (sql: string, ...params: unknown[]): void => {
    raw.prepare(sql).run(...(params as never[]));
  };

  // --- instellingen ---------------------------------------------------------
  const settings: Array<[string, unknown]> = [
    ['capaciteit', DEFAULT_CAPACITY_SETTINGS],
    ['appointments_per_unit', DEFAULT_APPOINTMENTS_PER_UNIT],
    ['lead_time_weeks', DEFAULT_LEAD_TIME_WEEKS],
    ['verlofsaldo_administratie', false],
    ['goedkeuring_verlof_verplicht', true],
    ['min_bezetting_begeleiders', 1],
    ['netwerkstand', { mode: 'standalone', port: 4317 }],
    ['donkere_modus', 'systeem'],
    ['backup', { tijd: '23:00', bewaar_dagelijks: 30, bewaar_maandelijks: 12 }],
    ['minimum_marge_bp', 1500],
    ['ai', { model: 'claude-opus-5', maandbudget_cents: 5000, anonimiseer_standaard: true }],
  ];
  for (const [key, value] of settings) {
    run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
  }

  // --- keuzelijsten ---------------------------------------------------------
  const picklist = (key: string, name: string): number => {
    run('INSERT INTO picklists (key, name, is_system) VALUES (?, ?, 1)', key, name);
    return Number(raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
  };
  const items = (picklistId: number, values: Array<[string, string, string?]>): void => {
    values.forEach(([value, label, color], index) => {
      run(
        'INSERT INTO picklist_items (picklist_id, value, label, color, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        picklistId,
        value,
        label,
        color ?? null,
        index,
        index === 0 ? 1 : 0,
      );
    });
  };

  const phaseTypes = picklist('projectfase', 'Projectfase');
  items(phaseTypes, [
    ['showroom', 'Showroom', '#2563eb'],
    ['sluiting', 'Sluiting', '#1d4ed8'],
    ['start_bouw', 'Start bouw', '#a3a3a3'],
    ['oplevering', 'Oplevering', '#65a30d'],
    ['overig', 'Overig', '#78716c'],
  ]);

  const orgTypes = picklist('organisatiesoort', 'Soort organisatie');
  items(orgTypes, [
    ['aannemer', 'Aannemer'],
    ['ontwikkelaar', 'Ontwikkelaar'],
    ['woningcorporatie', 'Woningcorporatie'],
    ['leverancier', 'Leverancier'],
    ['koper', 'Koper'],
  ]);

  const projectStatus = picklist('projectstatus', 'Projectstatus');
  items(projectStatus, [
    ['in_voorbereiding', 'In voorbereiding', '#a3a3a3'],
    ['lopend', 'Lopend', '#2563eb'],
    ['afgerond', 'Afgerond', '#16a34a'],
    ['on_hold', 'On hold', '#ea580c'],
  ]);

  const lossReasons = picklist('verliesreden', 'Verliesreden');
  items(lossReasons, [
    ['prijs', 'Prijs'],
    ['concurrent', 'Naar concurrent'],
    ['uitgesteld', 'Project uitgesteld'],
    ['afgeblazen', 'Project afgeblazen'],
    ['geen_reactie', 'Geen reactie'],
    ['overig', 'Overig'],
  ]);

  const sources = picklist('bron', 'Bron');
  items(sources, [
    ['bestaande_relatie', 'Bestaande relatie'],
    ['aanbesteding', 'Aanbesteding'],
    ['website', 'Website'],
    ['beurs', 'Beurs'],
    ['aanbeveling', 'Aanbeveling'],
  ]);

  const outcomes = picklist('gespreksuitkomst', 'Gespreksuitkomst');
  items(outcomes, [
    ['bereikt', 'Bereikt'],
    ['niet_bereikt', 'Niet bereikt'],
    ['terugbellen', 'Terugbellen'],
    ['afspraak', 'Afspraak gemaakt'],
    ['geen_interesse', 'Geen interesse'],
  ]);

  // --- afwezigheids- en inzettypes -----------------------------------------
  // Goedkeuring staat aan voor verlof en ADV, uit voor ziekte en feestdag
  // (hoofdstuk 16.1). De aard van een ziekte wordt nooit vastgelegd; alleen
  // de afwezigheid, en die is voor collega's zichtbaar als "Afwezig".
  const absenceTypes: Array<[string, string, string, number, number, number, string]> = [
    ['Verlof', 'VERLOF', '#9ca3af', 1, 1, 1, 'iedereen'],
    ['ADV', 'ADV', '#a8a29e', 1, 1, 1, 'iedereen'],
    ['Ziekte', 'ZIEKTE', '#dc2626', 1, 0, 0, 'management'],
    ['Feestdag', 'FEESTDAG', '#e5e7eb', 1, 0, 0, 'iedereen'],
    ['Opleiding/cursus', 'OPLEIDING', '#0891b2', 1, 0, 1, 'iedereen'],
    ['Zorgverlof', 'ZORG', '#d97706', 1, 1, 1, 'management'],
    ['Bijzonder verlof', 'BIJZONDER', '#7c3aed', 1, 1, 1, 'management'],
    ['Overig', 'OVERIG', '#78716c', 1, 0, 1, 'iedereen'],
  ];
  absenceTypes.forEach(([name, code, color, reduces, leave, approval, visibility], index) => {
    run(
      `INSERT INTO absence_types
         (name, code, color, sort_order, reduces_capacity, counts_as_leave, requires_approval, allow_half_days, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      name,
      code,
      color,
      index,
      reduces,
      leave,
      approval,
      visibility,
    );
  });

  const allocationTypes: Array<[string, string, string]> = [
    ['Ander bouwproject', 'ANDER_PROJECT', '#7c3aed'],
    ['Intern project', 'INTERN', '#8b5cf6'],
    ['Opleiding/traject', 'TRAJECT', '#0891b2'],
    ['Beurs/evenement', 'BEURS', '#c026d3'],
    ['Vervanging andere afdeling', 'VERVANGING', '#9333ea'],
    ['Overig werk', 'OVERIG', '#78716c'],
  ];
  allocationTypes.forEach(([name, code, color], index) => {
    run(
      'INSERT INTO allocation_types (name, code, color, sort_order) VALUES (?, ?, ?, ?)',
      name,
      code,
      color,
      index,
    );
  });

  // --- feestdagen voor dit en volgend jaar ---------------------------------
  for (const year of [reference.year, reference.year + 1]) {
    for (const holiday of generateHolidays(year)) {
      run(
        'INSERT INTO holidays (name, date, is_day_off, auto_generated, year) VALUES (?, ?, ?, 1, ?)',
        holiday.name,
        holiday.date,
        holiday.isDayOff ? 1 : 0,
        year,
      );
    }
  }

  // --- disciplines ----------------------------------------------------------
  const disciplines: Array<[string, string, string]> = [
    ['TEG', 'Tegelwerk', '#ea580c'],
    ['SAN', 'Sanitair', '#0891b2'],
    ['KEU', 'Keuken', '#ca8a04'],
    ['VLV', 'Vloerverwarming', '#dc2626'],
    ['ELE', 'Elektra', '#eab308'],
    ['BDR', 'Binnendeuren', '#78716c'],
    ['TRP', 'Trappen', '#a16207'],
    ['ZON', 'Zonwering', '#65a30d'],
    ['DUZ', 'Duurzaamheid', '#16a34a'],
  ];
  disciplines.forEach(([code, name, color], index) => {
    run(
      'INSERT INTO disciplines (code, name, color, sort_order) VALUES (?, ?, ?, ?)',
      code,
      name,
      color,
      index,
    );
  });

  // --- pijplijn en fasen ----------------------------------------------------
  run("INSERT INTO pipelines (name, is_default) VALUES ('Showroomverkoop', 1)");
  const pipelineId = Number(raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
  const stages: Array<[string, number, number, number, number | null, string]> = [
    ['Kwalificatie', 1000, 0, 0, 30, '#a3a3a3'],
    ['Verkennend gesprek', 2500, 0, 0, 30, '#0891b2'],
    ['Offerte uit', 5000, 0, 0, 21, '#2563eb'],
    ['Onderhandeling', 7500, 0, 0, 14, '#7c3aed'],
    ['Gewonnen', 10_000, 1, 0, null, '#16a34a'],
    ['Verloren', 0, 0, 1, null, '#dc2626'],
  ];
  stages.forEach(([name, probability, isWon, isLost, rotting, color], index) => {
    run(
      `INSERT INTO pipeline_stages
         (pipeline_id, name, sort_order, default_probability_bp, is_won, is_lost, rotting_days, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      pipelineId,
      name,
      index,
      probability,
      isWon,
      isLost,
      rotting,
      color,
    );
  });

  // --- sluitingsperiodes ----------------------------------------------------
  // Bouwvak: drie weken in augustus. Kerst: week 52 tot en met week 1.
  for (const year of [reference.year, reference.year + 1]) {
    const bouwvakStart = isoWeekStart(getIsoWeek(new Date(Date.UTC(year, 7, 1))));
    run(
      'INSERT INTO closure_periods (name, start_date, end_date) VALUES (?, ?, ?)',
      `Bouwvak zomer ${year}`,
      toIsoDate(addDays(bouwvakStart, 7)),
      toIsoDate(addDays(bouwvakStart, 27)),
    );
    run(
      'INSERT INTO closure_periods (name, start_date, end_date) VALUES (?, ?, ?)',
      `Kerstsluiting ${year}`,
      `${year}-12-24`,
      `${year + 1}-01-02`,
    );
  }

  // --- nummerreeksen --------------------------------------------------------
  for (const [key, prefix] of [
    ['opportunities', 'K'],
    ['projects', 'P'],
    ['package_quotes', 'OF'],
  ] as const) {
    run(
      "INSERT INTO number_sequences (key, prefix, next_value, padding, reset_period) VALUES (?, ?, 1, 4, 'jaar')",
      key,
      prefix,
    );
  }

  // --- gebruikers en roosters ----------------------------------------------
  // DM en PD werken 5 x 8 uur, RB 4 x 8 uur (maandag t/m donderdag) zodat de
  // parttime-logica meteen in de praktijk getest wordt.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: Array<{
    name: string;
    initials: string;
    email: string;
    role: string;
    guide: boolean;
    color: string;
    days: [number, number, number, number, number, number, number];
    appointments: number;
  }> = [
    {
      name: 'Dennis van de Meeberg',
      initials: 'DM',
      email: 'dennis@showroom.local',
      role: 'user',
      guide: true,
      color: '#2563eb',
      days: [8, 8, 8, 8, 8, 0, 0],
      appointments: 3,
    },
    {
      name: 'Patrick Dekker',
      initials: 'PD',
      email: 'patrick@showroom.local',
      role: 'admin',
      guide: true,
      color: '#16a34a',
      days: [8, 8, 8, 8, 8, 0, 0],
      appointments: 3,
    },
    {
      name: 'Robert de Bergh',
      initials: 'RB',
      email: 'robert@showroom.local',
      role: 'user',
      guide: true,
      color: '#ea580c',
      days: [8, 8, 8, 8, 0, 0, 0],
      appointments: 3,
    },
    {
      name: 'Marieke Manager',
      initials: 'MM',
      email: 'manager@showroom.local',
      role: 'manager',
      guide: false,
      color: '#7c3aed',
      days: [8, 8, 8, 8, 8, 0, 0],
      appointments: 0,
    },
    {
      name: 'Meekijker Acquisitie',
      initials: 'MA',
      email: 'acquisitie@showroom.local',
      role: 'readonly',
      guide: false,
      color: '#78716c',
      days: [8, 8, 8, 8, 8, 0, 0],
      appointments: 0,
    },
  ];

  for (const user of users) {
    run(
      `INSERT INTO users (name, initials, email, password_hash, role, color, is_kopersbegeleider, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      user.name,
      user.initials,
      user.email,
      passwordHash,
      user.role,
      user.color,
      user.guide ? 1 : 0,
    );
    const userId = Number(raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
    run(
      `INSERT INTO work_schedules
         (user_id, valid_from, valid_to, mon_hours, tue_hours, wed_hours, thu_hours, fri_hours, sat_hours, sun_hours, appointments_per_week, note)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      `${reference.year - 1}-01-01`,
      ...user.days,
      user.appointments,
      user.guide ? 'Kopersbegeleider' : 'Geen showroomcapaciteit',
    );
  }

  seedEmailTemplates(handle);
  seedAiPresets(handle);
  seedAlertRules(handle);
}

// ---------------------------------------------------------------------------
// E-mailsjablonen, AI-presets en signaleringsregels
// ---------------------------------------------------------------------------

function seedEmailTemplates(handle: DatabaseHandle): void {
  const templates: Array<[string, string, string, string, string]> = [
    [
      'Kennismaking',
      'KENNISMAKING',
      'contacts',
      'Kennismaking showroom {{organisatie.naam}}',
      '<p>Beste {{contact.voornaam}},</p><p>Graag stel ik ons showroomtraject aan u voor. ' +
        'In de showroom begeleiden wij kopers bij het kiezen van hun afbouw.</p>' +
        '<p>Met vriendelijke groet,<br>{{gebruiker.naam}}</p>',
    ],
    [
      'Offerte toesturen',
      'OFFERTE',
      'package_quotes',
      'Offerte {{offerte.nummer}}',
      '<p>Beste {{contact.voornaam}},</p><p>Hierbij ontvangt u offerte ' +
        '{{offerte.nummer}} met een totaalbedrag van {{offerte.totaal}}.</p>' +
        '<p>Met vriendelijke groet,<br>{{gebruiker.naam}}</p>',
    ],
    [
      'Opvolging na offerte',
      'OPVOLGING',
      'package_quotes',
      'Uw offerte {{offerte.nummer}}',
      '<p>Beste {{contact.voornaam}},</p><p>Een week geleden stuurde ik u offerte ' +
        '{{offerte.nummer}}. Heeft u die kunnen bekijken?</p>' +
        '<p>Met vriendelijke groet,<br>{{gebruiker.naam}}</p>',
    ],
    [
      'Afspraakbevestiging showroom',
      'AFSPRAAK',
      'activities',
      'Bevestiging showroomafspraak',
      '<p>Beste {{contact.voornaam}},</p><p>Hierbij bevestig ik uw showroomafspraak voor ' +
        '{{project.plaats}}.</p><p>Met vriendelijke groet,<br>{{gebruiker.naam}}</p>',
    ],
    [
      'Bedankt na oplevering',
      'BEDANKT',
      'projects',
      'Bedankt voor uw vertrouwen',
      '<p>Beste {{contact.voornaam}},</p><p>Uw woning is opgeleverd. Wij danken u voor ' +
        'het vertrouwen.</p><p>Met vriendelijke groet,<br>{{gebruiker.naam}}</p>',
    ],
  ];

  for (const [name, code, scope, subject, body] of templates) {
    handle.raw
      .prepare(
        `INSERT INTO email_templates (name, code, entity_scope, subject, body_html, variables)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        code,
        scope,
        subject,
        body,
        JSON.stringify([
          'contact.voornaam',
          'organisatie.naam',
          'offerte.nummer',
          'offerte.totaal',
          'project.plaats',
          'gebruiker.naam',
          'vandaag',
        ]),
      );
  }
}

function seedAiPresets(handle: DatabaseHandle): void {
  const presets: Array<[string, string, string, number]> = [
    [
      'Opvolg-e-mail na offerte',
      'e-mail',
      'Schrijf een korte, vriendelijke Nederlandse opvolgmail bij een uitgebrachte offerte. ' +
        'Houd het zakelijk maar warm, maximaal 150 woorden, en eindig met een concrete vraag.',
      1,
    ],
    [
      'Eerste kennismakingsmail',
      'e-mail',
      'Schrijf een Nederlandse kennismakingsmail namens de afdeling Showroom van een ' +
        'woningbouworganisatie. Kort, concreet en zonder verkooppraat.',
      1,
    ],
    [
      'Samenvatting klantdossier',
      'analyse',
      'Vat het klantdossier samen in maximaal tien bullets: wie het is, wat er speelt, ' +
        'wat de laatste contactmomenten waren en wat de logische vervolgstap is.',
      1,
    ],
    [
      'Acquisitietekst bij vrije showroomcapaciteit',
      'acquisitie',
      'Schrijf een korte wervende Nederlandse tekst voor acquisitie, gericht op aannemers ' +
        'en ontwikkelaars, wanneer er showroomcapaciteit vrijkomt.',
      0,
    ],
    [
      'Nette afwijzing',
      'e-mail',
      'Schrijf een nette, korte Nederlandse afwijzing die de deur open houdt voor later.',
      1,
    ],
  ];

  for (const [name, category, prompt, anonymise] of presets) {
    handle.raw
      .prepare(
        `INSERT INTO ai_presets (name, category, system_prompt, user_prompt_template, anonymise_personal_data)
         VALUES (?, ?, ?, '', ?)`,
      )
      .run(name, category, prompt, anonymise);
  }
}

function seedAlertRules(handle: DatabaseHandle): void {
  const rules: Array<[string, string, Record<string, unknown>, string]> = [
    ['Showroom loopt leeg', 'capacity_gap',
      { horizonWeeks: 26, thresholdPct: 50, minConsecutiveWeeks: 3, leadTimeWeeks: 8 }, 'let_op'],
    ['Overbezetting', 'capacity_overload', { thresholdPct: 100, horizonWeeks: 12 }, 'let_op'],
    ['Te weinig bezetting door verlof of inzet', 'capacity_understaffed',
      { horizonWeeks: 12 }, 'urgent'],
    ['Verlof duwt een week over de drempel', 'absence_conflict', {}, 'let_op'],
    ['Te weinig begeleiders tegelijk beschikbaar', 'absence_overlap',
      { minGuidesAvailable: 1 }, 'urgent'],
    ['Collega komt weer beschikbaar', 'allocation_ending', { daysAhead: 21 }, 'info'],
    ['Ziekmelding zonder einddatum', 'sick_leave_open', { days: 7 }, 'let_op'],
    ['Showroomfase met een enkele begeleider die afwezig is', 'project_single_guide', {}, 'urgent'],
    ['Project zonder showroomplanning', 'project_unplanned', {}, 'let_op'],
    ['Project start binnenkort zonder begeleider', 'project_phase_missing',
      { daysBefore: 60 }, 'let_op'],
    ['Kans staat te lang stil', 'opportunity_stale', {}, 'info'],
    ['Sluitdatum nadert', 'opportunity_closing', { daysAhead: 14 }, 'info'],
    ['Offerte zonder reactie', 'quote_no_response', { days: 7 }, 'let_op'],
    ['Offerte verloopt binnenkort', 'quote_expiring', { days: 7 }, 'info'],
    ['Activiteit over datum', 'followup_overdue', {}, 'let_op'],
    ['Lang geen contact', 'contact_dormant', { days: 180 }, 'info'],
    ['Datakwaliteit', 'data_quality', {}, 'info'],
    ['Back-up mislukt', 'backup_failed', {}, 'urgent'],
  ];

  for (const [name, type, params, severity] of rules) {
    handle.raw
      .prepare(
        "INSERT INTO alert_rules (name, type, params, severity, check_cron) VALUES (?, ?, ?, ?, '0 * * * *')",
      )
      .run(name, type, JSON.stringify(params), severity);
  }
}

// ---------------------------------------------------------------------------
// Demo — een realistisch showroomjaar (bijlage A)
// ---------------------------------------------------------------------------

export function seedDemo(handle: DatabaseHandle, reference: IsoWeek): void {
  const { raw } = handle;
  const run = (sql: string, ...params: unknown[]): number => {
    raw.prepare(sql).run(...(params as never[]));
    return Number(raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
  };
  const scalar = (sql: string, ...params: unknown[]): number =>
    Number((raw.prepare(sql).get(...(params as never[])) as { id: number }).id);

  const userId = (initials: string): number =>
    scalar('SELECT id FROM users WHERE initials = ?', initials);
  const phaseTypeId = (value: string): number =>
    scalar(
      `SELECT i.id AS id FROM picklist_items i
         JOIN picklists p ON p.id = i.picklist_id
        WHERE p.key = 'projectfase' AND i.value = ?`,
      value,
    );
  const orgTypeId = (value: string): number =>
    scalar(
      `SELECT i.id AS id FROM picklist_items i
         JOIN picklists p ON p.id = i.picklist_id
        WHERE p.key = 'organisatiesoort' AND i.value = ?`,
      value,
    );
  const disciplineId = (code: string): number =>
    scalar('SELECT id FROM disciplines WHERE code = ?', code);

  const dm = userId('DM');
  const pd = userId('PD');
  const rb = userId('RB');

  // --- organisaties en contactpersonen -------------------------------------
  const organizations: Array<[string, string, string, string, string]> = [
    ['Bouwbedrijf Meesters B.V.', 'aannemer', 'Tilburg', '5011 AA', 'info@meesters.local'],
    ['CECI Ontwikkeling', 'ontwikkelaar', 'Breda', '4811 BB', 'contact@ceci.local'],
    ['Woonstichting De Hoventier', 'woningcorporatie', 'Eindhoven', '5611 CC', 'info@hovenier.local'],
    ['Van Dijk Bouw', 'aannemer', 'Den Bosch', '5211 DD', 'info@vandijkbouw.local'],
    ['SolarPartner Nederland', 'leverancier', 'Utrecht', '3511 EE', 'sales@solarpartner.local'],
  ];
  const orgIds = new Map<string, number>();
  for (const [name, type, city, postcode, email] of organizations) {
    const id = run(
      `INSERT INTO organizations (name, org_type_id, city, postcode, email, owner_user_id, status_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      name,
      orgTypeId(type),
      city,
      postcode,
      email,
      pd,
    );
    orgIds.set(name, id);
  }

  const contacts: Array<[string, string, string, string, string]> = [
    ['Bouwbedrijf Meesters B.V.', 'Jan', 'de', 'Vries', 'j.devries@meesters.local'],
    ['CECI Ontwikkeling', 'Sanne', '', 'Bakker', 's.bakker@ceci.local'],
    ['Woonstichting De Hoventier', 'Ahmed', '', 'El Amrani', 'a.elamrani@hovenier.local'],
    ['Van Dijk Bouw', 'Ingrid', 'van', 'Dijk', 'i.vandijk@vandijkbouw.local'],
  ];
  for (const [org, firstName, infix, lastName, email] of contacts) {
    run(
      `INSERT INTO contacts (organization_id, first_name, infix, last_name, email, is_primary, owner_user_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      orgIds.get(org) ?? null,
      firstName,
      infix || null,
      lastName,
      email,
      pd,
    );
  }

  // --- projecten ------------------------------------------------------------
  // De tijdlijn is bewust zo gelegd dat elke signaleringsregel iets te melden
  // heeft: druk in het lopende kwartaal, een leegte een half jaar vooruit, een
  // project zonder showroomfase, en een niet-showroomproject om inzet elders
  // aan te koppelen.
  type DemoProject = {
    name: string;
    plan: string;
    city: string;
    units: number;
    contractor: string;
    countsAsShowroom: boolean;
    phases: Array<{ type: string; from: number; to: number }>;
    assignments: Array<[number, number]>;
  };

  const projects: DemoProject[] = [
    {
      name: 'Plan CECI',
      plan: 'CECI fase 1',
      city: 'Breda',
      units: 24,
      contractor: 'CECI Ontwikkeling',
      countsAsShowroom: true,
      phases: [
        { type: 'showroom', from: 8, to: 15 },
        { type: 'sluiting', from: 16, to: 18 },
        { type: 'start_bouw', from: 22, to: 24 },
      ],
      assignments: [[dm, 10_000]],
    },
    {
      name: 'Meesters fase 2',
      plan: 'Meesterlijk Wonen',
      city: 'Tilburg',
      units: 18,
      contractor: 'Bouwbedrijf Meesters B.V.',
      countsAsShowroom: true,
      // Gedeelde begeleiding DM/PD 50-50: de test voor het splitsen van
      // gecombineerde codes uit de Excel-import.
      phases: [
        { type: 'showroom', from: -2, to: 5 },
        { type: 'sluiting', from: 6, to: 8 },
      ],
      assignments: [
        [dm, 5_000],
        [pd, 5_000],
      ],
    },
    {
      name: 'De Hoventier hof',
      plan: 'Hovenierhof',
      city: 'Eindhoven',
      units: 12,
      contractor: 'Woonstichting De Hoventier',
      countsAsShowroom: true,
      phases: [{ type: 'showroom', from: 0, to: 6 }],
      assignments: [[rb, 10_000]],
    },
    {
      name: 'Kwartier Noord',
      plan: 'Kwartier',
      city: 'Den Bosch',
      units: 30,
      contractor: 'Van Dijk Bouw',
      countsAsShowroom: true,
      // Start bouw aanwezig, showroomfase ontbreekt -> project_unplanned.
      phases: [{ type: 'start_bouw', from: 10, to: 12 }],
      assignments: [],
    },
    {
      name: 'Renovatie Kerkstraat',
      plan: 'Kerkstraat',
      city: 'Tilburg',
      units: 8,
      contractor: 'Bouwbedrijf Meesters B.V.',
      // Geen showroombelasting; dient om de inzet van DM aan te koppelen.
      countsAsShowroom: false,
      phases: [{ type: 'overig', from: 0, to: 5 }],
      assignments: [],
    },
  ];

  const projectIds = new Map<string, number>();
  projects.forEach((project, index) => {
    const id = run(
      `INSERT INTO projects
         (number, name, plan_name, city, unit_count, contractor_organization_id, counts_as_showroom, status_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      `P${String(reference.year).slice(2)}${String(index + 1).padStart(3, '0')}`,
      project.name,
      project.plan,
      project.city,
      project.units,
      orgIds.get(project.contractor) ?? null,
      project.countsAsShowroom ? 1 : 0,
    );
    projectIds.set(project.name, id);

    for (const phase of project.phases) {
      run(
        `INSERT INTO project_phases (project_id, phase_type_id, start_date, end_date, is_capacity_load)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        phaseTypeId(phase.type),
        weekStart(reference, phase.from),
        weekEnd(reference, phase.to),
        // Alleen showroom en sluiting belasten de afdeling (hoofdstuk 1).
        phase.type === 'showroom' || phase.type === 'sluiting' ? 1 : 0,
      );
    }

    for (const [user, share] of project.assignments) {
      run(
        'INSERT INTO project_assignments (project_id, user_id, role, share_bp) VALUES (?, ?, ?, ?)',
        id,
        user,
        'kopersbegeleider',
        share,
      );
    }
  });

  // --- afwezigheid ----------------------------------------------------------
  const absenceTypeId = (code: string): number =>
    scalar('SELECT id FROM absence_types WHERE code = ?', code);

  // RB twee weken verlof midden in een drukke periode: dit is wat
  // capacity_understaffed moet oppikken.
  run(
    `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, day_part, status, decided_by, decided_at, note)
     VALUES (?, ?, ?, ?, 'hele_dag', 'goedgekeurd', ?, datetime('now'), ?)`,
    rb,
    absenceTypeId('VERLOF'),
    weekStart(reference, 2),
    weekEnd(reference, 3),
    pd,
    'Twee weken vakantie',
  );

  // DM drie losse verlofdagen.
  for (const [offset, weekday] of [
    [1, 5],
    [4, 1],
    [7, 3],
  ] as const) {
    const day = weekDay(reference, offset, weekday);
    run(
      `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, day_part, status, decided_by, decided_at)
       VALUES (?, ?, ?, ?, 'hele_dag', 'goedgekeurd', ?, datetime('now'))`,
      dm,
      absenceTypeId('VERLOF'),
      day,
      day,
      pd,
    );
  }

  // PD een halve dag opleiding.
  const trainingDay = weekDay(reference, 3, 2);
  run(
    `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, day_part, status, note)
     VALUES (?, ?, ?, ?, 'ochtend', 'goedgekeurd', 'Cursus kopersbegeleiding')`,
    pd,
    absenceTypeId('OPLEIDING'),
    trainingDay,
    trainingDay,
  );

  // Een ziekmelding zonder einddatum: end_date NULL betekent "tot nader order".
  // De aard van de ziekte wordt niet vastgelegd (hoofdstuk 10).
  run(
    `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, day_part, status)
     VALUES (?, ?, ?, NULL, 'hele_dag', 'goedgekeurd')`,
    rb,
    absenceTypeId('ZIEKTE'),
    weekDay(reference, -1, 1),
  );

  // --- inzet elders ---------------------------------------------------------
  // DM zit zes weken voor 40% op Renovatie Kerkstraat. De inzet loopt af net
  // voordat de rustige periode begint: dat levert het positieve signaal
  // allocation_ending op ("DM komt weer volledig beschikbaar").
  run(
    `INSERT INTO capacity_allocations
       (user_id, allocation_type_id, title, project_id, start_date, end_date,
        allocation_mode, allocation_value, status, note)
     VALUES (?, ?, ?, ?, ?, ?, 'percentage', 40, 'actief', ?)`,
    dm,
    scalar("SELECT id FROM allocation_types WHERE code = 'ANDER_PROJECT'"),
    'Renovatie Kerkstraat',
    projectIds.get('Renovatie Kerkstraat') ?? null,
    weekStart(reference, 0),
    weekEnd(reference, 5),
    'Tijdelijke ondersteuning op de renovatie',
  );

  run(
    `INSERT INTO capacity_allocations
       (user_id, allocation_type_id, title, external_project_name, start_date, end_date,
        allocation_mode, allocation_value, status)
     VALUES (?, ?, ?, ?, ?, ?, 'dagen_per_week', 2, 'gepland')`,
    pd,
    scalar("SELECT id FROM allocation_types WHERE code = 'INTERN'"),
    'Implementatie Showroom Suite',
    'Intern ICT-traject',
    weekStart(reference, 6),
    weekEnd(reference, 9),
  );

  seedProductsAndPackages(handle, orgIds.get('SolarPartner Nederland') ?? null);

  // --- kansen ---------------------------------------------------------------
  const stageId = (name: string): number =>
    scalar('SELECT id FROM pipeline_stages WHERE name = ?', name);
  const pipelineId = scalar('SELECT id FROM pipelines WHERE is_default = 1');

  const opportunities: Array<{
    name: string;
    org: string;
    stage: string;
    units: number;
    weeksAhead: number;
    lines: Array<[string, number, number]>;
  }> = [
    {
      name: 'Plan Zuidhoek 32 woningen',
      org: 'CECI Ontwikkeling',
      stage: 'Offerte uit',
      units: 32,
      weeksAhead: 24,
      lines: [
        ['TEG', 32, 185_000],
        ['SAN', 32, 240_000],
        ['KEU', 32, 650_000],
      ],
    },
    {
      name: 'Meesters fase 3',
      org: 'Bouwbedrijf Meesters B.V.',
      stage: 'Onderhandeling',
      units: 20,
      weeksAhead: 28,
      lines: [
        ['TEG', 20, 185_000],
        ['VLV', 20, 145_000],
        ['DUZ', 20, 420_000],
      ],
    },
    {
      name: 'Hovenier appartementen',
      org: 'Woonstichting De Hoventier',
      stage: 'Verkennend gesprek',
      units: 40,
      weeksAhead: 30,
      lines: [
        ['SAN', 40, 210_000],
        ['ELE', 40, 95_000],
      ],
    },
  ];

  for (const opportunity of opportunities) {
    const id = run(
      `INSERT INTO opportunities
         (number, name, organization_id, owner_user_id, pipeline_id, stage_id, status,
          probability_bp, expected_close_date, expected_showroom_start, expected_showroom_end,
          expected_units, stage_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, datetime('now'))`,
      `K${String(reference.year).slice(2)}${String(opportunity.units).padStart(4, '0')}`,
      opportunity.name,
      orgIds.get(opportunity.org) ?? null,
      pd,
      pipelineId,
      stageId(opportunity.stage),
      scalar('SELECT default_probability_bp AS id FROM pipeline_stages WHERE name = ?', opportunity.stage),
      weekStart(reference, opportunity.weeksAhead - 4),
      weekStart(reference, opportunity.weeksAhead),
      weekEnd(reference, opportunity.weeksAhead + 7),
      opportunity.units,
    );

    opportunity.lines.forEach(([code, quantity, unitPrice], index) => {
      run(
        `INSERT INTO opportunity_lines
           (opportunity_id, discipline_id, quantity, unit, unit_price_cents, amount_cents, sort_order)
         VALUES (?, ?, ?, 'woning', ?, ?, ?)`,
        id,
        disciplineId(code),
        quantity,
        unitPrice,
        quantity * unitPrice,
        index,
      );
    });

    raw
      .prepare(
        `UPDATE opportunities SET
           amount_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM opportunity_lines WHERE opportunity_id = ?),
           weighted_amount_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM opportunity_lines WHERE opportunity_id = ?) * probability_bp / 10000
         WHERE id = ?`,
      )
      .run(id, id, id);
  }
}

function seedProductsAndPackages(handle: DatabaseHandle, supplierId: number | null): void {
  const { raw } = handle;
  const run = (sql: string, ...params: unknown[]): number => {
    raw.prepare(sql).run(...(params as never[]));
    return Number(raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
  };

  const categories = ['Zonnepanelen', 'Omvormers', 'Thuisbatterijen', 'Laadpalen', 'Montage', 'Arbeid'];
  const categoryIds = new Map<string, number>();
  categories.forEach((name, index) => {
    categoryIds.set(
      name,
      run('INSERT INTO product_categories (name, sort_order) VALUES (?, ?)', name, index),
    );
  });

  // sku, naam, categorie, eenheid, inkoop (ct), verkoop (ct), btw (bp)
  const products: Array<[string, string, string, string, number, number, number]> = [
    ['PV-445', 'Zonnepaneel 445 Wp full black', 'Zonnepanelen', 'stuk', 9_500, 15_900, 2100],
    ['PV-500', 'Zonnepaneel 500 Wp', 'Zonnepanelen', 'stuk', 11_000, 17_900, 2100],
    ['INV-1F-3K', 'Omvormer 1-fase 3 kW', 'Omvormers', 'stuk', 48_000, 79_500, 2100],
    ['INV-1F-5K', 'Omvormer 1-fase 5 kW', 'Omvormers', 'stuk', 62_000, 99_500, 2100],
    ['INV-3F-8K', 'Omvormer 3-fase 8 kW', 'Omvormers', 'stuk', 89_000, 139_500, 2100],
    ['INV-3F-12K', 'Omvormer 3-fase 12 kW', 'Omvormers', 'stuk', 118_000, 179_500, 2100],
    ['BAT-5', 'Thuisbatterij 5 kWh', 'Thuisbatterijen', 'stuk', 245_000, 349_000, 2100],
    ['BAT-10', 'Thuisbatterij 10 kWh', 'Thuisbatterijen', 'stuk', 439_000, 619_000, 2100],
    ['BAT-MGT', 'Batterijmanagementsysteem', 'Thuisbatterijen', 'stuk', 42_000, 69_000, 2100],
    ['LP-11', 'Laadpaal 11 kW 3-fase', 'Laadpalen', 'stuk', 78_000, 119_000, 2100],
    ['LP-22', 'Laadpaal 22 kW 3-fase', 'Laadpalen', 'stuk', 105_000, 159_000, 2100],
    ['LP-KAB', 'Laadkabel type 2, 5 m', 'Laadpalen', 'stuk', 8_500, 14_900, 2100],
    ['LP-PAAL', 'Montagezuil laadpaal', 'Laadpalen', 'stuk', 12_000, 21_500, 2100],
    ['MNT-RAIL', 'Montagerail 2,1 m', 'Montage', 'stuk', 1_450, 2_650, 2100],
    ['MNT-KLEM', 'Eindklem set', 'Montage', 'set', 320, 690, 2100],
    ['MNT-HAAK', 'Dakhaak RVS', 'Montage', 'stuk', 285, 590, 2100],
    ['MNT-KAB', 'Zonnekabel 6 mm2', 'Montage', 'meter', 130, 295, 2100],
    ['MNT-OPT', 'Optimizer', 'Montage', 'stuk', 5_400, 8_900, 2100],
    ['ARB-PV', 'Montage-uur zonnestroom', 'Arbeid', 'uur', 4_200, 7_500, 2100],
    ['ARB-ELE', 'Installatie-uur elektra', 'Arbeid', 'uur', 4_500, 8_250, 2100],
  ];

  const productIds = new Map<string, number>();
  for (const [sku, name, category, unit, purchase, sales, vat] of products) {
    productIds.set(
      sku,
      run(
        `INSERT INTO products (sku, name, category_id, unit, purchase_price_cents, sales_price_cents, vat_rate_bp, supplier_organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sku,
        name,
        categoryIds.get(category) ?? null,
        unit,
        purchase,
        sales,
        vat,
        supplierId,
      ),
    );
  }

  // De vier voorbeeldpakketten uit hoofdstuk 6.5.
  const packages: Array<{
    code: string;
    name: string;
    mode: string;
    fixed: number | null;
    margin: number;
    items: Array<[string, number, boolean]>;
  }> = [
    {
      code: 'PV10',
      name: 'Zonnepanelen 10 panelen + omvormer',
      mode: 'sum',
      fixed: null,
      margin: 0,
      items: [
        ['PV-445', 10, false],
        ['INV-1F-3K', 1, false],
        ['MNT-RAIL', 6, false],
        ['MNT-KLEM', 4, false],
        ['MNT-HAAK', 20, false],
        ['MNT-KAB', 30, false],
        ['ARB-PV', 8, false],
        ['MNT-OPT', 10, true],
      ],
    },
    {
      code: 'BAT5',
      name: 'Thuisbatterij 5 kWh',
      mode: 'sum_with_margin',
      fixed: null,
      margin: 1200,
      items: [
        ['BAT-5', 1, false],
        ['BAT-MGT', 1, false],
        ['ARB-ELE', 6, false],
      ],
    },
    {
      code: 'LP11',
      name: 'Laadpaal 11 kW 3-fase',
      mode: 'fixed',
      fixed: 189_500,
      margin: 0,
      items: [
        ['LP-11', 1, false],
        ['LP-KAB', 1, false],
        ['ARB-ELE', 4, false],
        ['LP-PAAL', 1, true],
      ],
    },
    {
      code: 'COMBI',
      name: 'Combi: PV + accu + laadpaal',
      mode: 'sum_with_margin',
      fixed: null,
      margin: 1000,
      items: [
        ['PV-445', 12, false],
        ['INV-3F-8K', 1, false],
        ['BAT-5', 1, false],
        ['LP-11', 1, false],
        ['MNT-RAIL', 8, false],
        ['MNT-HAAK', 24, false],
        ['ARB-PV', 10, false],
        ['ARB-ELE', 8, false],
        ['BAT-10', 1, true],
      ],
    },
  ];

  packages.forEach((pkg, index) => {
    const packageId = run(
      `INSERT INTO packages (code, name, pricing_mode, fixed_price_cents, margin_bp, vat_mode, sort_order, category_id)
       VALUES (?, ?, ?, ?, ?, 'excl', ?, ?)`,
      pkg.code,
      pkg.name,
      pkg.mode,
      pkg.fixed,
      pkg.margin,
      index,
      categoryIds.get('Zonnepanelen') ?? null,
    );

    pkg.items.forEach(([sku, quantity, optional], itemIndex) => {
      const productId = productIds.get(sku)!;
      const price = Number(
        (
          raw.prepare('SELECT sales_price_cents AS id FROM products WHERE id = ?').get(productId) as {
            id: number;
          }
        ).id,
      );
      run(
        `INSERT INTO package_items (package_id, product_id, quantity, unit_price_cents, is_optional, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        packageId,
        productId,
        quantity,
        price,
        optional ? 1 : 0,
        itemIndex,
      );
    });
  });
}

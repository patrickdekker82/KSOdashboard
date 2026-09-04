/**
 * Entity registry for the generic CRUD factory (hoofdstuk 5).
 *
 * One definition per entity; the factory in `routes.ts` turns each into the
 * full set of endpoints. Columns are listed explicitly so a request can never
 * write or filter on something that was not intended — `password_hash` being
 * the obvious example.
 */
import type { UserRole } from '@showroom/shared';

export type EntityDefinition = {
  /** URL segment, e.g. `capacity-allocations`. */
  key: string;
  table: string;
  /** Columns a client may write. `id` and the audit columns are never here. */
  writable: string[];
  /** Columns a client may filter and sort on. */
  filterable: string[];
  /** Default ORDER BY when the request does not ask for one. */
  defaultSort: string;
  /** Columns searched by the `q` parameter. */
  searchable?: string[];
  /** Minimum role needed to write. Reading needs any session. */
  writeRole?: UserRole;
  /** Whether the table carries `archived_at` (soft delete). */
  softDelete?: boolean;
  /** Whether the table carries `custom_fields`. */
  customFields?: boolean;
};

const AUDIT = ['created_at', 'updated_at', 'created_by', 'updated_by', 'archived_at'];

function entity(definition: EntityDefinition): EntityDefinition {
  return { softDelete: true, customFields: true, writeRole: 'user', ...definition };
}

// `field-definitions` staat hier bewust NIET in: velden hebben regels die de
// generieke factory niet kent, en worden door modules/fields/routes.ts bediend.
export const ENTITIES: EntityDefinition[] = [
  entity({
    key: 'users',
    table: 'users',
    // password_hash staat hier bewust niet bij: niet schrijfbaar, niet
    // filterbaar en dus ook niet per ongeluk te doorzoeken.
    writable: [
      'name', 'initials', 'email', 'role', 'color', 'active', 'is_kopersbegeleider',
      'windows_account', 'custom_fields',
    ],
    filterable: ['id', 'name', 'initials', 'email', 'role', 'active', 'is_kopersbegeleider', ...AUDIT],
    searchable: ['name', 'initials', 'email'],
    defaultSort: 'initials ASC',
    writeRole: 'admin',
  }),
  entity({
    key: 'organizations',
    table: 'organizations',
    writable: [
      'name', 'legal_name', 'org_type_id', 'kvk_number', 'vat_number', 'website', 'phone',
      'email', 'address_street', 'address_number', 'address_addition', 'postcode', 'city',
      'country', 'owner_user_id', 'source_id', 'status_id', 'rating', 'description',
      'parent_organization_id', 'custom_fields',
    ],
    filterable: ['id', 'name', 'city', 'postcode', 'kvk_number', 'email', 'owner_user_id', 'status_id', ...AUDIT],
    searchable: ['name', 'city', 'kvk_number', 'email', 'phone'],
    defaultSort: 'name ASC',
  }),
  entity({
    key: 'contacts',
    table: 'contacts',
    writable: [
      'organization_id', 'salutation', 'first_name', 'infix', 'last_name', 'initials',
      'job_title', 'department', 'email', 'phone', 'mobile', 'linkedin', 'is_primary',
      'do_not_email', 'do_not_call', 'birthday', 'notes', 'owner_user_id',
      'marketing_consent', 'consent_at', 'consent_source', 'custom_fields',
    ],
    filterable: ['id', 'organization_id', 'last_name', 'email', 'owner_user_id', 'is_primary', ...AUDIT],
    searchable: ['first_name', 'last_name', 'email', 'phone', 'mobile'],
    defaultSort: 'last_name ASC',
  }),
  entity({
    key: 'projects',
    table: 'projects',
    writable: [
      'number', 'name', 'organization_id', 'contractor_organization_id',
      'developer_organization_id', 'opportunity_id', 'city', 'plan_name', 'unit_count',
      'unit_types', 'status_id', 'counts_as_showroom', 'appointments_per_unit',
      'lead_time_weeks', 'contract_value_cents', 'showroom_revenue_cents', 'risk_note',
      'description', 'color', 'custom_fields',
    ],
    filterable: ['id', 'number', 'name', 'city', 'unit_count', 'status_id', 'counts_as_showroom', ...AUDIT],
    searchable: ['name', 'plan_name', 'city', 'number'],
    defaultSort: 'name ASC',
  }),
  entity({
    key: 'project-phases',
    table: 'project_phases',
    writable: [
      'project_id', 'phase_type_id', 'start_date', 'end_date', 'unit_count_override',
      'note', 'is_capacity_load', 'custom_fields',
    ],
    filterable: ['id', 'project_id', 'phase_type_id', 'start_date', 'end_date', 'is_capacity_load', ...AUDIT],
    defaultSort: 'start_date ASC',
  }),
  entity({
    key: 'project-assignments',
    table: 'project_assignments',
    writable: ['project_id', 'user_id', 'role', 'share_bp', 'start_date', 'end_date'],
    filterable: ['id', 'project_id', 'user_id', 'role', ...AUDIT],
    defaultSort: 'id ASC',
    customFields: false,
  }),
  entity({
    key: 'opportunities',
    table: 'opportunities',
    writable: [
      'number', 'name', 'organization_id', 'primary_contact_id', 'owner_user_id',
      'pipeline_id', 'stage_id', 'status', 'probability_bp', 'currency',
      'expected_close_date', 'actual_close_date', 'expected_showroom_start',
      'expected_showroom_end', 'expected_units', 'source_id', 'loss_reason_id',
      'loss_note', 'competitor', 'project_id', 'description', 'next_step',
      'next_step_date', 'custom_fields',
    ],
    filterable: [
      'id', 'number', 'name', 'organization_id', 'owner_user_id', 'stage_id', 'status',
      'amount_cents', 'expected_close_date', 'expected_showroom_start', 'last_activity_at', ...AUDIT,
    ],
    searchable: ['name', 'number', 'description'],
    defaultSort: 'updated_at DESC',
  }),
  entity({
    key: 'opportunity-lines',
    table: 'opportunity_lines',
    writable: [
      'opportunity_id', 'discipline_id', 'description', 'quantity', 'unit',
      'unit_price_cents', 'discount_bp', 'cost_price_cents', 'probability_bp',
      'status', 'won_amount_cents', 'expected_start', 'expected_end', 'sort_order',
      'custom_fields',
    ],
    filterable: ['id', 'opportunity_id', 'discipline_id', 'status', ...AUDIT],
    defaultSort: 'sort_order ASC',
  }),
  entity({
    key: 'pipelines',
    table: 'pipelines',
    writable: ['name', 'entity_target', 'is_default', 'active'],
    filterable: ['id', 'name', 'is_default', 'active'],
    defaultSort: 'name ASC',
    customFields: false,
    writeRole: 'admin',
  }),
  entity({
    key: 'pipeline-stages',
    table: 'pipeline_stages',
    writable: [
      'pipeline_id', 'name', 'sort_order', 'default_probability_bp', 'is_won', 'is_lost',
      'rotting_days', 'color',
    ],
    filterable: ['id', 'pipeline_id', 'name', 'is_won', 'is_lost'],
    defaultSort: 'sort_order ASC',
    customFields: false,
    writeRole: 'admin',
  }),
  entity({
    key: 'disciplines',
    table: 'disciplines',
    writable: [
      'code', 'name', 'description', 'color', 'default_margin_bp', 'default_lead_weeks',
      'sort_order', 'active', 'custom_fields',
    ],
    filterable: ['id', 'code', 'name', 'active', ...AUDIT],
    defaultSort: 'sort_order ASC',
  }),
  entity({
    key: 'absences',
    table: 'absences',
    writable: [
      'user_id', 'absence_type_id', 'start_date', 'end_date', 'day_part',
      'hours_override', 'status', 'note', 'external_ref', 'custom_fields',
    ],
    filterable: ['id', 'user_id', 'absence_type_id', 'start_date', 'end_date', 'status', ...AUDIT],
    defaultSort: 'start_date DESC',
  }),
  entity({
    key: 'capacity-allocations',
    table: 'capacity_allocations',
    writable: [
      'user_id', 'allocation_type_id', 'title', 'project_id', 'external_project_name',
      'organization_id', 'start_date', 'end_date', 'allocation_mode', 'allocation_value',
      'status', 'is_billable', 'note', 'color', 'custom_fields',
    ],
    filterable: ['id', 'user_id', 'allocation_type_id', 'project_id', 'start_date', 'end_date', 'status', ...AUDIT],
    searchable: ['title', 'external_project_name'],
    defaultSort: 'start_date DESC',
  }),
  entity({
    key: 'work-schedules',
    table: 'work_schedules',
    writable: [
      'user_id', 'valid_from', 'valid_to', 'mon_hours', 'tue_hours', 'wed_hours',
      'thu_hours', 'fri_hours', 'sat_hours', 'sun_hours', 'appointments_per_week',
      'note', 'custom_fields',
    ],
    filterable: ['id', 'user_id', 'valid_from', 'valid_to', ...AUDIT],
    defaultSort: 'valid_from DESC',
    writeRole: 'manager',
  }),
  entity({
    key: 'absence-types',
    table: 'absence_types',
    writable: [
      'name', 'code', 'color', 'sort_order', 'active', 'reduces_capacity',
      'counts_as_leave', 'requires_approval', 'allow_half_days', 'visibility',
      'custom_fields',
    ],
    filterable: ['id', 'code', 'name', 'active', ...AUDIT],
    defaultSort: 'sort_order ASC',
    writeRole: 'admin',
  }),
  entity({
    key: 'allocation-types',
    table: 'allocation_types',
    writable: [
      'name', 'code', 'color', 'sort_order', 'active', 'reduces_showroom_capacity',
      'custom_fields',
    ],
    filterable: ['id', 'code', 'name', 'active', ...AUDIT],
    defaultSort: 'sort_order ASC',
    writeRole: 'admin',
  }),
  entity({
    key: 'holidays',
    table: 'holidays',
    writable: ['name', 'date', 'is_day_off', 'year', 'note'],
    filterable: ['id', 'date', 'year', 'is_day_off'],
    defaultSort: 'date ASC',
    softDelete: false,
    customFields: false,
    writeRole: 'admin',
  }),
  entity({
    key: 'closure-periods',
    table: 'closure_periods',
    writable: ['name', 'start_date', 'end_date', 'user_id', 'recurring_rule'],
    filterable: ['id', 'name', 'start_date', 'end_date', 'user_id', ...AUDIT],
    defaultSort: 'start_date ASC',
    customFields: false,
    writeRole: 'manager',
  }),
  entity({
    key: 'products',
    table: 'products',
    writable: [
      'sku', 'name', 'category_id', 'brand', 'model', 'unit', 'purchase_price_cents',
      'sales_price_cents', 'vat_rate_bp', 'supplier_organization_id', 'specs',
      'description', 'active', 'custom_fields',
    ],
    filterable: ['id', 'sku', 'name', 'category_id', 'active', ...AUDIT],
    searchable: ['sku', 'name', 'brand', 'model'],
    defaultSort: 'name ASC',
  }),
  entity({
    key: 'packages',
    table: 'packages',
    writable: [
      'code', 'name', 'description', 'category_id', 'pricing_mode', 'fixed_price_cents',
      'margin_bp', 'vat_mode', 'valid_from', 'valid_to', 'active', 'sort_order',
      'default_terms', 'estimated_install_hours', 'custom_fields',
    ],
    filterable: ['id', 'code', 'name', 'active', 'pricing_mode', ...AUDIT],
    searchable: ['code', 'name', 'description'],
    defaultSort: 'sort_order ASC',
  }),
  entity({
    key: 'package-items',
    table: 'package_items',
    writable: [
      'package_id', 'product_id', 'description', 'quantity', 'unit_price_cents',
      'discount_bp', 'is_optional', 'is_quantity_variable', 'sort_order', 'category_label',
    ],
    filterable: ['id', 'package_id', 'product_id', 'is_optional'],
    defaultSort: 'sort_order ASC',
    customFields: false,
  }),
  entity({
    key: 'activities',
    table: 'activities',
    writable: [
      'type', 'subject', 'body', 'outcome_id', 'status', 'priority', 'due_at',
      'reminder_at', 'completed_at', 'duration_minutes', 'assigned_user_id', 'custom_fields',
    ],
    filterable: ['id', 'type', 'status', 'priority', 'due_at', 'assigned_user_id', 'completed_at', ...AUDIT],
    searchable: ['subject', 'body'],
    defaultSort: 'due_at ASC',
  }),
  entity({
    key: 'email-templates',
    table: 'email_templates',
    writable: [
      'name', 'code', 'category_id', 'subject', 'body_html', 'body_text', 'language',
      'variables', 'attachments', 'entity_scope', 'is_active', 'ai_generated',
    ],
    filterable: ['id', 'code', 'name', 'entity_scope', 'is_active', ...AUDIT],
    defaultSort: 'name ASC',
    customFields: false,
    writeRole: 'manager',
  }),
  entity({
    key: 'picklists',
    table: 'picklists',
    writable: ['key', 'name', 'description'],
    filterable: ['id', 'key', 'name'],
    defaultSort: 'name ASC',
    customFields: false,
    writeRole: 'admin',
  }),
  entity({
    key: 'picklist-items',
    table: 'picklist_items',
    writable: ['picklist_id', 'value', 'label', 'color', 'sort_order', 'is_default', 'metadata'],
    filterable: ['id', 'picklist_id', 'value', 'label'],
    defaultSort: 'sort_order ASC',
    customFields: false,
    writeRole: 'admin',
  }),
  entity({
    key: 'saved-views',
    table: 'saved_views',
    writable: [
      'entity_key', 'name', 'owner_user_id', 'is_shared', 'is_default', 'columns',
      'filters', 'sort', 'group_by', 'page_size', 'layout',
    ],
    filterable: ['id', 'entity_key', 'owner_user_id', 'is_shared', ...AUDIT],
    defaultSort: 'name ASC',
    customFields: false,
  }),
  entity({
    key: 'alert-rules',
    table: 'alert_rules',
    writable: ['name', 'type', 'params', 'severity', 'active', 'recipients', 'check_cron'],
    filterable: ['id', 'type', 'severity', 'active', ...AUDIT],
    defaultSort: 'name ASC',
    customFields: false,
    writeRole: 'admin',
  }),
];

export const ENTITY_BY_KEY = new Map(ENTITIES.map((definition) => [definition.key, definition]));

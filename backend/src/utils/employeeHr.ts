// Employee HR fields (migration 024) — shared camelCase→snake_case mapping so
// every employee write path (account / teacher / driver / staff) persists the
// same columns the same way. `official_photo` is NOT here: it is set only by
// the dedicated photo-upload endpoint, never by a create/update body.

const HR_FIELD_MAP: Record<string, string> = {
  address: 'address',
  hireDate: 'hire_date',
  nationalId: 'national_id',
  dateOfBirth: 'date_of_birth',
  maritalStatus: 'marital_status',
  gender: 'gender',
  employmentType: 'employment_type',
  qualifications: 'qualifications',
  notes: 'notes',
};

interface HrColumnOptions {
  // Include emergency_contact in the mapping. Default false: teachers/drivers
  // set it explicitly in their own controllers; account/staff opt in here.
  includeEmergency?: boolean;
}

/**
 * Build a {snake_column: value} patch from the HR fields present on a request
 * body. Only keys actually present are included, so this is safe for both
 * create (omitted → DB default null) and partial update (omitted → untouched).
 * Empty strings normalize to null. Date fields are passed through verbatim
 * (the validator already shapes them to '' | YYYY-MM-DD; '' → null here).
 */
export function hrColumns(
  body: Record<string, unknown>,
  opts: HrColumnOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map = opts.includeEmergency
    ? { ...HR_FIELD_MAP, emergencyContact: 'emergency_contact' }
    : HR_FIELD_MAP;
  for (const [camel, col] of Object.entries(map)) {
    if (body[camel] !== undefined) {
      const v = body[camel];
      out[col] = v === '' || v === null ? null : v;
    }
  }
  return out;
}

/**
 * Snapshot the HR fields off a DB row (snake_case) into a camelCase object,
 * used to preserve them in the archive `account` JSONB blob. `officialPhoto`
 * is included so the professional photo survives archiving (kept-forever).
 */
export function hrSnapshot(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return {};
  return {
    address: row.address ?? null,
    hireDate: row.hire_date ?? null,
    nationalId: row.national_id ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    maritalStatus: row.marital_status ?? null,
    gender: row.gender ?? null,
    employmentType: row.employment_type ?? null,
    qualifications: row.qualifications ?? null,
    notes: row.notes ?? null,
    emergencyContact: row.emergency_contact ?? null,
    officialPhoto: row.official_photo ?? null,
  };
}

// Cross-school student transfer — bundle builder (migration 032, phase A).
//
// Produces the JSON pack the parent walks to a non-Scholify destination.
// Companion PDF (transferBundlePdf.ts) is built separately for human
// reading; the JSON pack is the canonical, machine-importable artefact.
//
// Format: `scholify.transfer.v1`
//
//   {
//     "format": "scholify.transfer.v1",
//     "generatedAt": ISO-8601,
//     "transferId": uuid,
//     "sourceSchool": { name, address, phone, publicId? },
//     "student": { fullName, dateOfBirth, gender, phoneNumber,
//                  emergencyContact, homeAddress },
//     "parents": [ { fullName, phoneNumber } ],
//     "destination": { kind, schoolName, city, country, contact },
//     "consent": { parentName, textVersion, signedAt, witness*, hash },
//     "academicRecord": {
//       "enrollmentHistory": [ <EnrollmentSnapshotEntry>, … ],
//       "grades": [ <flattened grade row>, … ]
//     },
//     "documents": [ { id, category, fileName, uploadedAt, sensitivity } ],
//   }
//
// Then wrapped in a signed envelope:
//
//   {
//     "format": "scholify.transfer.v1.signed",
//     "bundle": <inner>,
//     "integrity": {
//       "algorithm": "HMAC-SHA256",
//       "sha256": <hex of canonical inner>,
//       "signature": <hex HMAC of canonical inner>,
//       "keyId": "platform-v1",
//       "signedAt": ISO-8601
//     }
//   }
//
// Verification: re-canonicalise `bundle`, recompute SHA-256, compare. For
// HMAC verification the destination needs Scholify's published key under
// `keyId`. Phase B will swap HMAC for an Ed25519 signature so non-Scholify
// destinations can verify against a published public key.

import crypto from 'crypto';
import { adminDb as supabase } from './db';
import { loadEnrollmentHistory, rowsToSnapshot } from './studentEnrollments';

export const BUNDLE_FORMAT = 'scholify.transfer.v1';
export const SIGNED_FORMAT = 'scholify.transfer.v1.signed';
export const CONSENT_TEXT_VERSION = 'v1';

// ───── Canonical JSON (RFC 8785-ish: sort keys, no whitespace) ────────
//
// Sufficient for our purposes — every reader must reproduce the same byte
// stream. We don't need full JCS; sorting keys + JSON.stringify is enough
// because we never have floats, just strings / integers / booleans / null.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalise(obj[key]);
    }
    return out;
  }
  return value;
}

// ───── Signing ────────────────────────────────────────────────────────
//
// Phase A uses HMAC-SHA256 with a server-side key. The key MUST be set in
// production via TRANSFER_SIGNING_KEY env. Local dev derives from
// JWT_SECRET so the flow works out of the box, but production deployments
// should set a dedicated key — rotating the JWT secret should not silently
// invalidate every existing bundle's verification.

function getSigningKey(): { key: Buffer; keyId: string } {
  const explicit = process.env.TRANSFER_SIGNING_KEY;
  if (explicit && explicit.length >= 32) {
    return { key: Buffer.from(explicit, 'utf8'), keyId: 'transfer-v1' };
  }
  const fallback = process.env.JWT_SECRET || 'scholify-dev-fallback';
  // Derive a domain-separated key from JWT_SECRET so we never sign with
  // the literal JWT secret (compromising it shouldn't auto-compromise the
  // signing key — and vice versa).
  const derived = crypto
    .createHmac('sha256', fallback)
    .update('scholify.transfer.signing.v1')
    .digest();
  return { key: derived, keyId: 'derived-v1' };
}

export function signBundle(bundle: unknown): {
  sha256: string;
  signature: string;
  keyId: string;
  signedAt: string;
  canonical: string;
} {
  const canonical = canonicalJson(bundle);
  const sha256 = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  const { key, keyId } = getSigningKey();
  const signature = crypto.createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
  return { sha256, signature, keyId, signedAt: new Date().toISOString(), canonical };
}

// ───── Consent canonicalisation + hash ────────────────────────────────
//
// The consent hash is a tamper-evidence anchor: changing any of the
// inputs after capture would change the hash and reveal manipulation.
// Hash inputs are domain-separated by a prefix so the same bytes can't be
// replayed against a different anchor type.

export interface ConsentInput {
  transferId: string;
  studentId: string;
  studentName: string;
  parentName: string;
  textVersion: string;
  destinationSchoolName: string;
  signedAt: string;
  witnessName: string;
  witnessRole: string;
}

export function hashConsent(input: ConsentInput): string {
  const canonical = canonicalJson({
    _domain: 'scholify.transfer.consent.v1',
    ...input,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// The consent text shown to (and signed by) the parent. Translations
// live in i18n; this is the canonical English version stored alongside
// `consent_text_version` so future versions are recognisable.

export const CONSENT_TEXT_V1 =
  'I authorise the transfer of my child\'s educational records — including ' +
  'identity details, academic progression, grades, and document metadata — ' +
  'from {{sourceSchool}} to {{destinationSchool}}. I confirm I am the parent ' +
  'or legal guardian and that the destination school named above is the ' +
  'intended recipient. This authorisation is recorded at the source school ' +
  'and a signed bundle is generated for me to deliver to the destination.';

export function consentText(sourceSchool: string, destinationSchool: string): string {
  return CONSENT_TEXT_V1
    .replace('{{sourceSchool}}', sourceSchool)
    .replace('{{destinationSchool}}', destinationSchool);
}

// ───── Bundle assembly ────────────────────────────────────────────────

export interface TransferBundle {
  format: string;
  generatedAt: string;
  transferId: string;
  sourceSchool: {
    name: string;
    abbreviation: string | null;
    logoUrl: string | null;
    publicId: string | null;        // reserved for SCH_* (phase B)
  };
  student: {
    fullName: string;
    dateOfBirth: string | null;
    phoneNumber: string | null;
    emergencyContact: string | null;
    homeAddress: string | null;
  };
  parents: Array<{ fullName: string; phoneNumber: string | null }>;
  destination: {
    kind: 'non_scholify' | 'scholify';
    schoolName: string;
    city: string | null;
    country: string | null;
    contact: string | null;
  };
  consent: {
    parentName: string;
    textVersion: string;
    signedAt: string;
    witnessName: string;
    witnessRole: string;
    hash: string;
  };
  academicRecord: {
    enrollmentHistory: Array<Record<string, unknown>>;
    grades: Array<Record<string, unknown>>;
  };
}

export interface SignedTransferBundle {
  format: string;
  bundle: TransferBundle;
  integrity: {
    algorithm: 'HMAC-SHA256';
    sha256: string;
    signature: string;
    keyId: string;
    signedAt: string;
  };
}

// Builds the bundle for a transfer that is at least in `consented` state.
// Returns the inner bundle + the signed envelope + the canonical bytes
// (callers persist sha256 + signature on student_transfers).
export async function buildTransferBundle(
  schoolId: string,
  transferId: string,
): Promise<{ bundle: TransferBundle; signed: SignedTransferBundle; canonical: string } | null> {
  const { data: transfer } = await supabase
    .from('student_transfers')
    .select('*')
    .eq('id', transferId)
    .eq('school_id', schoolId)
    .single();
  if (!transfer) return null;

  const studentId = (transfer as any).student_id as string | null;
  if (!studentId) return null;          // transfer was completed (live row gone) or never linked

  const [{ data: school }, { data: student }] = await Promise.all([
    supabase.from('schools').select('name, abbreviation, logo_url').eq('id', schoolId).single(),
    supabase
      .from('students')
      .select(`id, full_name, date_of_birth, phone_number, emergency_contact,
               home_address, parents(full_name, phone_number)`)
      .eq('id', studentId).eq('school_id', schoolId).single(),
  ]);
  if (!school || !student) return null;

  // Academic record. Enrollment history from the first-class table; grades
  // pulled fresh from the live grades table (only released entries — we
  // don't ship unreleased work-in-progress to another institution).
  const enrollmentRows = await loadEnrollmentHistory(schoolId, studentId);
  const enrollmentHistory = rowsToSnapshot(enrollmentRows).map(e => ({ ...e }));

  const { data: gradeRows } = await supabase
    .from('grades')
    .select('academic_year, grading_period, subject, marks, daily_grade, quiz_grade, monthly_exam_grade, term_exam_grade')
    .eq('student_id', studentId).eq('school_id', schoolId)
    .eq('is_released', true)
    .order('academic_year');

  const grades = (gradeRows || []).map((g: any) => ({
    academicYear: g.academic_year,
    gradingPeriod: g.grading_period,
    subject: g.subject,
    marks: Array.isArray(g.marks) ? g.marks : [],
    dailyGrade: g.daily_grade,
    quizGrade: g.quiz_grade,
    monthlyExamGrade: g.monthly_exam_grade,
    termExamGrade: g.term_exam_grade,
  }));

  // Documents intentionally omitted from phase A: this product doesn't
  // currently have a unified student document table (employee_documents
  // is HR-only). When student documents land, add metadata-only entries
  // here — never embed binary content (size + privacy).

  const parents: Array<{ fullName: string; phoneNumber: string | null }> = [];
  const parentObj = (student as any).parents;
  if (parentObj) {
    parents.push({
      fullName: parentObj.full_name || '',
      phoneNumber: parentObj.phone_number ?? null,
    });
  }

  const t: any = transfer;
  const bundle: TransferBundle = {
    format: BUNDLE_FORMAT,
    generatedAt: new Date().toISOString(),
    transferId,
    sourceSchool: {
      name: school.name,
      abbreviation: (school as any).abbreviation ?? null,
      logoUrl: (school as any).logo_url ?? null,
      publicId: null,                   // reserved for SCH_* (phase B)
    },
    student: {
      fullName: (student as any).full_name,
      dateOfBirth: (student as any).date_of_birth ?? null,
      phoneNumber: (student as any).phone_number ?? null,
      emergencyContact: (student as any).emergency_contact ?? null,
      homeAddress: (student as any).home_address ?? null,
    },
    parents,
    destination: {
      kind: t.destination_kind,
      schoolName: t.destination_school_name,
      city: t.destination_city ?? null,
      country: t.destination_country ?? null,
      contact: t.destination_contact ?? null,
    },
    consent: {
      parentName: t.consent_parent_name || '',
      textVersion: t.consent_text_version || CONSENT_TEXT_VERSION,
      signedAt: t.consent_signed_at || '',
      witnessName: t.consent_witness_name || '',
      witnessRole: t.consent_witness_role || '',
      hash: t.consent_hash || '',
    },
    academicRecord: { enrollmentHistory, grades },
  };

  const sig = signBundle(bundle);
  const signed: SignedTransferBundle = {
    format: SIGNED_FORMAT,
    bundle,
    integrity: {
      algorithm: 'HMAC-SHA256',
      sha256: sig.sha256,
      signature: sig.signature,
      keyId: sig.keyId,
      signedAt: sig.signedAt,
    },
  };

  return { bundle, signed, canonical: sig.canonical };
}

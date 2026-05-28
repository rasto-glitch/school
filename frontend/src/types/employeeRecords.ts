// Wave 2 employee-records types. Extends the Wave 1 types in
// employeeDocs.ts. Encrypted columns surface as plaintext or as the
// '[hr_officer_required]' sentinel; the UI uses the sentinel to render
// a redaction badge instead of an editable input.

import type { EmployeeRole, OwnerType } from './employeeDocs';

export type { EmployeeRole, OwnerType };

export const REDACTED = '[hr_officer_required]';

export interface ExtendedProfile {
  redacted?: boolean;
  redactedAt?: string | null;
  redactedReason?: string | null;
  // Plaintext / low sensitivity
  placeOfBirth: string | null;
  nationality: string | null;
  bloodType: string | null;
  languagesSpoken: string[] | null;
  dependentsCount: number | null;
  bankName: string | null;
  // Encrypted — medium sensitivity (decrypted for any admin / self)
  motherFullName: string | null;
  fatherFullName: string | null;
  spouseName: string | null;
  bankIban: string | null;
  taxId: string | null;
  // Encrypted — high sensitivity (HR officer only; non-HR sees REDACTED)
  religion: string | null;
  socialInsuranceNo: string | null;
  consentPiiAt: string | null;
  consentPiiBy: string | null;
  updatedAt: string | null;
}

export interface ExtendedProfileResponse {
  profile: ExtendedProfile | null;
  hrOfficer: boolean;
}

export interface EmergencyContact {
  id: string;
  fullName: string;
  relationship: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  priority: number;
  createdAt: string;
}

export interface SchoolPolicy {
  id: string;
  policyKey: string;
  label: string;
  version: number;
  body: string | null;
  documentUrl: string | null;
  isRequired: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AcknowledgementStatusItem {
  policyKey: string;
  label: string;
  activePolicyId: string | null;
  activeVersion: number | null;
  documentUrl: string | null;
  isRequired: boolean;
  status: 'unsigned' | 'signed' | 'stale';
  ack: {
    id: string;
    policyVersion: number;
    acknowledgedAt: string;
    signedDocumentId: string | null;
  } | null;
}

export type ActionKind = 'review' | 'warning' | 'commendation' | 'role_change' | 'contract_change' | 'termination';

export interface EmployeeAction {
  id: string;
  kind: ActionKind;
  occurredOn: string;
  summary: string;
  rating: number | null;
  documentId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdByRole: string | null;
  createdAt: string;
}

export interface HrOfficer {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
}

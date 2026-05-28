// Wave 1 employee-records types. The active-employee profile shape mirrors
// archived_employees.account so the same view component can render both
// once Wave 2 migrates the archive viewer.

export type EmployeeRole =
  | 'teacher' | 'driver' | 'staff'
  | 'supervisor' | 'admin' | 'reception' | 'accountant';

export type OwnerType =
  | 'teachers' | 'drivers' | 'staff_members' | 'users' | 'archived_employees';

export type Sensitivity = 'low' | 'medium' | 'high';

export interface DocumentCategory {
  key: string;
  label: string;
  group: string;
  sensitivity: Sensitivity;
  requiresExpiry: boolean;
  override: boolean;
  active: boolean;
}

export interface EmployeeDocument {
  id: string;
  category: string;
  sensitivity: Sensitivity;
  filename?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  scanStatus: 'pending' | 'clean' | 'infected' | 'skipped';
  documentNumber?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
  uploadedAt: string;
  redacted: boolean;
}

export interface EmployeeProfileAccount {
  userId: string | null;
  username: string | null;
  email: string | null;
  isActive: boolean | null;
  passwordChangedAt: string | null;
  createdAt: string | null;
}

export interface EmployeeProfileContact {
  phoneNumber: string | null;
  emergencyContact: string | null;
  email: string | null;
}

export interface EmployeeProfileHr {
  address: string | null;
  hireDate: string | null;
  nationalId: string | null;
  dateOfBirth: string | null;
  maritalStatus: string | null;
  gender: string | null;
  employmentType: string | null;
  qualifications: string | null;
  notes: string | null;
}

export interface EmployeeProfile {
  role: EmployeeRole;
  ownerType: OwnerType;
  ownerId: string;
  schoolId: string;
  fullName: string;
  officialPhoto: string | null;
  account: EmployeeProfileAccount;
  contact: EmployeeProfileContact;
  hr: EmployeeProfileHr;
  teaching?: {
    subjects: { id: string; name: string; classes: { id: string; name: string }[] }[];
    classes: { id: string; name: string }[];
  };
  transport?: {
    licenseNumber: string | null;
    vehicleType: string | null;
    age: number | null;
    bus: { number: string | null; plate: string | null } | null;
    studentsAssigned: number;
  };
  employment?: {
    position: string | null;
    salaryAmount: number | null;
    currency: string | null;
    nextPaymentDate: string | null;
    insurancePercentage: number | null;
  };
}

export interface EmployeeProfileResponse {
  profile: EmployeeProfile;
  documents: EmployeeDocument[];
  hrOfficer: boolean;
}

export interface ExpiringDoc {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  ownerName: string;
  category: string;
  sensitivity: Sensitivity;
  documentNumber?: string | null;
  filename?: string;
  expiresOn: string;
  daysLeft: number;
  redacted: boolean;
}

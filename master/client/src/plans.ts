import type { SchoolFeatures } from './api';

export type PlanId = 'basic' | 'pro' | 'premium';

export interface PlanDef {
  id: PlanId;
  label: string;
  pricePerStudent: number;
  features: SchoolFeatures;
}

const make = (overrides: Partial<SchoolFeatures>): SchoolFeatures => ({
  academic_portal: false,
  homework: false,
  assignments: false,
  announcements: false,
  grades: false,
  reports: false,
  bus_tracking: false,
  appointments: false,
  attendance: false,
  weekly_summary: false,
  chat: false,
  ...overrides,
});

export const PLANS: Record<PlanId, PlanDef> = {
  basic: {
    id: 'basic',
    label: 'Basic',
    pricePerStudent: 5,
    features: make({ homework: true, assignments: true, announcements: true }),
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    pricePerStudent: 10,
    features: make({
      homework: true,
      assignments: true,
      announcements: true,
      reports: true,
      bus_tracking: true,
      appointments: true,
      weekly_summary: true,
    }),
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    pricePerStudent: 13,
    features: make({
      homework: true,
      assignments: true,
      announcements: true,
      reports: true,
      bus_tracking: true,
      appointments: true,
      weekly_summary: true,
      grades: true,
      attendance: true,
      academic_portal: true,
      chat: true,
    }),
  },
};

export const PLAN_IDS: PlanId[] = ['basic', 'pro', 'premium'];

export const isPlanId = (v: string): v is PlanId =>
  v === 'basic' || v === 'pro' || v === 'premium';

export const getPlan = (v: string | null | undefined): PlanDef =>
  v && isPlanId(v) ? PLANS[v] : PLANS.basic;

export const formatMonthlyCost = (plan: PlanDef, students: number): string =>
  `$${(plan.pricePerStudent * students).toLocaleString()}/mo`;

import { useTranslation } from 'react-i18next';
import { HeartPulse, AlertTriangle } from 'lucide-react';

// The read-only "safety subset" of a student's clinic health profile shown in
// teacher / supervisor / admin student views: allergies, chronic conditions,
// dietary notes. The full profile + nurse-visit log stay clinic-only.
export interface StudentHealthBrief {
  allergyTags: string[];
  chronicConditions: string | null;
  dietaryNotes: string | null;
  hasAny: boolean;
}

export default function HealthSafetyPanel({ health, className = '' }: { health?: StudentHealthBrief | null; className?: string }) {
  const { t } = useTranslation();
  if (!health || !health.hasAny) return null;

  return (
    <div className={`rounded-xl border border-rose-200 bg-rose-50/50 p-3 ${className}`}>
      <h3 className="font-semibold text-rose-800 flex items-center gap-2 mb-2 text-sm">
        <HeartPulse className="w-4 h-4" /> {t('healthBrief.title', 'Health & safety')}
      </h3>
      <div className="space-y-2 text-sm">
        {health.allergyTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" /> {t('healthBrief.allergies', 'Allergies')}:
            </span>
            {health.allergyTags.map((a, i) => (
              <span key={i} className="bg-rose-100 text-rose-800 rounded-full px-2 py-0.5 text-xs">{a}</span>
            ))}
          </div>
        )}
        {health.chronicConditions && (
          <div><span className="text-gray-600 font-medium">{t('healthBrief.conditions', 'Conditions')}: </span><span className="text-gray-900 whitespace-pre-wrap">{health.chronicConditions}</span></div>
        )}
        {health.dietaryNotes && (
          <div><span className="text-gray-600 font-medium">{t('healthBrief.dietary', 'Dietary notes')}: </span><span className="text-gray-900 whitespace-pre-wrap">{health.dietaryNotes}</span></div>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">{t('healthBrief.confidential', 'Confidential — for student safety only.')}</p>
    </div>
  );
}

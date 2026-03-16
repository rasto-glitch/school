import { BookOpen } from 'lucide-react';

interface SubjectBadgeProps {
  subject: string;
  loading?: boolean;
}

export default function SubjectBadge({ subject, loading }: SubjectBadgeProps) {
  if (loading) return (
    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
      <div className="w-3 h-3 rounded-full bg-gray-200 animate-pulse" />
      <span className="text-sm text-gray-400">Loading subject...</span>
    </div>
  );

  if (!subject) return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
      <BookOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
      <span className="text-sm text-amber-700">No subject assigned — contact your admin</span>
    </div>
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-200 rounded-xl">
      <BookOpen className="w-4 h-4 text-primary-600 flex-shrink-0" />
      <span className="text-sm font-semibold text-primary-800">{subject}</span>
      <span className="text-xs text-primary-500 ml-auto">Assigned by admin</span>
    </div>
  );
}

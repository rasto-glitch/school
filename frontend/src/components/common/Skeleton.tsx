function Shimmer({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

// ── Generic card (icon + title + subtitle + badge) ──────────────────────────
export function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="flex items-start gap-3">
        <Shimmer className="w-9 h-9 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2 min-w-0">
          <Shimmer className="h-4 w-3/4" />
          <Shimmer className="h-3 w-1/2" />
        </div>
        <Shimmer className="w-14 h-5 rounded-full flex-shrink-0" />
      </div>
    </div>
  );
}

export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4">
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

// ── Notifications (date group label + items with icon) ──────────────────────
export function NotificationListSkeleton() {
  return (
    <div className="space-y-6">
      {[4, 3].map((n, gi) => (
        <div key={gi}>
          <Shimmer className="h-3 w-20 mb-3" />
          <div className="space-y-2">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3">
                <Shimmer className="w-9 h-9 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Shimmer className="h-4 w-3/5" />
                  <Shimmer className="h-3 w-4/5" />
                  <Shimmer className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Announcements (hero block + card list) ───────────────────────────────────
export function AnnouncementsSkeleton() {
  return (
    <div className="space-y-6">
      <Shimmer className="h-36 w-full rounded-2xl" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3">
            <Shimmer className="w-9 h-9 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-4 w-2/3" />
              <Shimmer className="h-3 w-full" />
              <Shimmer className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Grades (card with side-by-side term tables) ──────────────────────────────
export function GradesTableSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Year header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <Shimmer className="h-4 w-32" />
      </div>
      {/* Term tables */}
      <div className="overflow-x-auto">
        <div className="inline-flex gap-0 min-w-full divide-x divide-gray-200">
          {[1, 2].map(t => (
            <div key={t} className="flex-1 min-w-[300px]">
              <div className="px-4 py-2 bg-primary-50 border-b border-gray-200">
                <Shimmer className="h-3 w-16" />
              </div>
              {/* Column headers */}
              <div className="flex gap-2 px-4 py-2 border-b border-gray-100">
                <Shimmer className="h-3 w-20 mr-auto" />
                {[1, 2, 3, 4, 5].map(c => <Shimmer key={c} className="h-3 w-10" />)}
              </div>
              {/* Subject rows */}
              {Array.from({ length: 4 }).map((_, ri) => (
                <div key={ri} className="flex gap-2 px-4 py-2.5 border-b border-gray-50">
                  <Shimmer className="h-4 w-24 mr-auto" />
                  {[1, 2, 3, 4].map(c => <Shimmer key={c} className="h-6 w-10 rounded-lg" />)}
                  <Shimmer className="h-6 w-12 rounded-lg" />
                </div>
              ))}
              {/* Term average row */}
              <div className="flex gap-2 px-4 py-2.5 bg-gray-50 border-t-2 border-gray-200">
                <Shimmer className="h-3 w-24 mr-auto" />
                <Shimmer className="h-6 w-12 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Year average */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t-2 border-gray-200">
        <Shimmer className="h-4 w-24" />
        <Shimmer className="h-6 w-14 rounded-lg" />
      </div>
    </div>
  );
}

// ── Dashboard (child chips + quick grid + activity feed) ────────────────────
export function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      {/* Child chips */}
      <div className="flex flex-wrap gap-2">
        {[1, 2].map(i => <Shimmer key={i} className="h-8 w-28 rounded-full" />)}
      </div>
      {/* Quick links grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-3 flex flex-col items-center gap-1.5">
            <Shimmer className="w-9 h-9 rounded-xl" />
            <Shimmer className="h-3 w-12" />
          </div>
        ))}
      </div>
      {/* Activity feed */}
      <div className="space-y-3">
        <Shimmer className="h-3 w-28" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-start gap-3">
            <Shimmer className="w-9 h-9 rounded-xl flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex justify-between">
                <Shimmer className="h-4 w-16 rounded-full" />
                <Shimmer className="h-3 w-12" />
              </div>
              <Shimmer className="h-4 w-3/4" />
              <Shimmer className="h-3 w-full" />
              <Shimmer className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

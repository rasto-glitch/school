interface PushStrings {
  bus_started_title: string;
  bus_started_body: string;
  bus_10min_title: string;
  bus_10min_body: string;
  bus_5min_title: string;
  bus_5min_body: string;
  bus_arriving_title: string;
  bus_arriving_body: string;
  prefix_homework: string;
  prefix_assignment: string;
  prefix_announcement: string;
  prefix_report: string;
  prefix_grade: string;
  prefix_general: string;
  prefix_system: string;
}

const T: Record<string, PushStrings> = {
  en: {
    bus_started_title: 'Bus Is On The Way',
    bus_started_body: "Your child's bus has started the route and is heading your way.",
    bus_10min_title: 'Bus 10 Minutes Away',
    bus_10min_body: 'The school bus is approximately 10 minutes away.',
    bus_5min_title: 'Bus 5 Minutes Away',
    bus_5min_body: 'The school bus is approximately 5 minutes away.',
    bus_arriving_title: 'Bus Arriving Now!',
    bus_arriving_body: 'The school bus is arriving at your location now!',
    prefix_homework: 'New Homework',
    prefix_assignment: 'New Assignment',
    prefix_announcement: 'New Announcement',
    prefix_report: 'New Report',
    prefix_grade: 'Grades Updated',
    prefix_general: 'Notification',
    prefix_system: 'System',
  },
  ku: {
    bus_started_title: 'پاس لە ڕێگایە',
    bus_started_body: 'پاسی منداڵەکەت دەستی بە ڕێگاکەی کردووە و بەرەو ماڵەکەتەوەیە.',
    bus_10min_title: 'پاس ١٠ خولەک دووری',
    bus_10min_body: 'پاسی قوتابخانە نزیکەی ١٠ خولەک دوورە.',
    bus_5min_title: 'پاس ٥ خولەک دووری',
    bus_5min_body: 'پاسی قوتابخانە نزیکەی ٥ خولەک دوورە.',
    bus_arriving_title: 'پاس ئێستا گەیشتووە!',
    bus_arriving_body: 'پاسی قوتابخانە ئێستا گەیشتووە بۆ شوێنەکەت!',
    prefix_homework: 'ئەرکی ماڵەوە',
    prefix_assignment: 'ئەرکی نوێ',
    prefix_announcement: 'ڕاگەیاندنی نوێ',
    prefix_report: 'ڕاپۆرتی نوێ',
    prefix_grade: 'نمرەکان نوێکرانەوە',
    prefix_general: 'ئاگادارکردنەوە',
    prefix_system: 'سیستەم',
  },
  ar: {
    bus_started_title: 'الحافلة في الطريق',
    bus_started_body: 'بدأت حافلة طفلك المسار وهي في طريقها إليك.',
    bus_10min_title: 'الحافلة على بعد 10 دقائق',
    bus_10min_body: 'الحافلة المدرسية على بعد حوالي 10 دقائق.',
    bus_5min_title: 'الحافلة على بعد 5 دقائق',
    bus_5min_body: 'الحافلة المدرسية على بعد حوالي 5 دقائق.',
    bus_arriving_title: 'الحافلة وصلت الآن!',
    bus_arriving_body: 'وصلت الحافلة المدرسية إلى موقعك الآن!',
    prefix_homework: 'الواجب المنزلي',
    prefix_assignment: 'مهمة جديدة',
    prefix_announcement: 'إعلان جديد',
    prefix_report: 'تقرير جديد',
    prefix_grade: 'تحديث الدرجات',
    prefix_general: 'إشعار',
    prefix_system: 'النظام',
  },
};

// Maps the English bus notification title to a translation key
const BUS_TITLE_KEY: Record<string, 'bus_started' | 'bus_10min' | 'bus_5min' | 'bus_arriving'> = {
  'Bus Is On The Way': 'bus_started',
  'Bus 10 Minutes Away': 'bus_10min',
  'Bus 5 Minutes Away': 'bus_5min',
  'Bus Arriving Now!': 'bus_arriving',
};

/**
 * Translates a push notification title and body for the given language.
 * - type === 'bus': fully translates both title and body
 * - other types: translates the title prefix only, keeps the body as-is
 */
export function translatePush(
  title: string,
  body: string,
  type: string,
  lang: string,
): { title: string; body: string } {
  const t = T[lang] ?? T.en;

  if (type === 'bus') {
    const key = BUS_TITLE_KEY[title];
    if (key) return { title: t[`${key}_title` as keyof PushStrings], body: t[`${key}_body` as keyof PushStrings] };
    return { title, body };
  }

  if (lang === 'en') return { title, body };

  // Content notifications: translate the prefix (title) only
  const prefixKey = `prefix_${type}` as keyof PushStrings;
  const translatedTitle = t[prefixKey] ?? title;
  return { title: translatedTitle, body };
}

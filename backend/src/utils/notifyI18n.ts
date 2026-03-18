interface PushStrings {
  bus_started_title: string;
  bus_started_body: string;
  bus_5min_title: string;
  bus_5min_body: string;
  bus_2min_title: string;
  bus_2min_body: string;
  bus_arriving_title: string;
  bus_arriving_body: string;
  bus_set_location_title: string;
  bus_set_location_body: string;
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
    bus_5min_title: 'Bus 5 Minutes Away',
    bus_5min_body: 'Your kid is 5 minutes away.',
    bus_2min_title: 'Bus 2 Minutes Away',
    bus_2min_body: 'Your kid is 2 minutes away.',
    bus_arriving_title: 'Your Child Has Arrived',
    bus_arriving_body: 'Your child has arrived.',
    bus_set_location_title: 'Set Your Pickup Location',
    bus_set_location_body: 'Open the app and set your location to receive bus proximity alerts.',
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
    bus_5min_title: 'پاس ٥ خولەک دووری',
    bus_5min_body: 'منداڵەکەت ٥ خولەک دووری.',
    bus_2min_title: 'پاس ٢ خولەک دووری',
    bus_2min_body: 'منداڵەکەت ٢ خولەک دووری.',
    bus_arriving_title: 'منداڵەکەت گەیشت!',
    bus_arriving_body: 'منداڵەکەت گەیشتووەتەوە.',
    bus_set_location_title: 'شوێنی وەرگرتنت دیاری بکە',
    bus_set_location_body: 'ئەپەکە بکەرەوە و شوێنەکەت دیاری بکە بۆ وەرگرتنی ئاگادارکردنەوەی پاس.',
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
    bus_5min_title: 'الحافلة على بعد 5 دقائق',
    bus_5min_body: 'طفلك على بعد 5 دقائق.',
    bus_2min_title: 'الحافلة على بعد دقيقتين',
    bus_2min_body: 'طفلك على بعد دقيقتين.',
    bus_arriving_title: 'وصل طفلك!',
    bus_arriving_body: 'وصل طفلك.',
    bus_set_location_title: 'حدد موقع التسليم',
    bus_set_location_body: 'افتح التطبيق وحدد موقعك لتلقي تنبيهات اقتراب الحافلة.',
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
const BUS_TITLE_KEY: Record<string, 'bus_started' | 'bus_5min' | 'bus_2min' | 'bus_arriving' | 'bus_set_location'> = {
  'Bus Is On The Way': 'bus_started',
  'Bus 5 Minutes Away': 'bus_5min',
  'Bus 2 Minutes Away': 'bus_2min',
  'Your Child Has Arrived': 'bus_arriving',
  'Set Your Pickup Location': 'bus_set_location',
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

// Shared bits for the per-record archive PDFs (archivedEmployeePdf,
// archivedStudentPdf): a label map for the three supported UI locales,
// a school-logo fetcher, and color constants.
//
// The label map is intentionally backend-local rather than reusing the
// frontend i18n bundle — keeps the backend dependency-free of the JSON
// locale files and lets us pick stable wording for printable documents
// (HR / legal / auditor audiences) independent of any UI rewording.

export type Lang = 'en' | 'ar' | 'ku';

export function pickLang(input: unknown): Lang {
  const s = typeof input === 'string' ? input.toLowerCase() : '';
  if (s === 'ar') return 'ar';
  if (s === 'ku') return 'ku';
  return 'en';
}

export const COLORS = {
  heading: '#111827',
  body: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  accent: '#4F46E5',
  panel: '#F9FAFB',
} as const;

export async function fetchLogoBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// Centralised label catalogue used by both PDFs. Every PDF string passes
// through L[lang][key] so a missing translation falls back to English
// rather than crashing the export.
export interface Labels {
  // top chrome
  archived_employee_record: string;
  archived_student_record: string;
  generated: string;
  by: string;
  archive_id: string;
  schema_version: string;
  page: string;
  of: string;
  em_dash: string;
  yes: string;
  no: string;
  // role names
  role_teacher: string;
  role_driver: string;
  role_staff: string;
  role_supervisor: string;
  role_admin: string;
  role_reception: string;
  role_accountant: string;
  // archive reasons
  reason_resigned: string;
  reason_terminated: string;
  reason_contract_ended: string;
  reason_retired: string;
  reason_transferred: string;
  reason_other: string;
  reason_graduated: string;
  reason_left: string;
  reason_relocated: string;
  reason_other_student: string;
  // section titles
  sec_personal: string;
  sec_contact: string;
  sec_employment: string;
  sec_teaching: string;
  sec_transport: string;
  sec_compensation: string;
  sec_account: string;
  sec_documents: string;
  sec_enrollment: string;
  sec_parent: string;
  sec_class_history: string;
  sec_academic_progression: string;  // migration 030 — supersedes sec_class_history
  sec_grades: string;
  // Enrollment status labels (migration 030)
  status_enrolled: string;
  status_promoted: string;
  status_retained: string;
  status_on_leave: string;
  status_withdrew: string;
  status_transferred: string;
  status_graduated: string;
  // field labels
  full_name: string;
  date_of_birth: string;
  age: string;
  nationality: string;
  national_id: string;
  gender: string;
  marital_status: string;
  address: string;
  phone: string;
  alt_phone: string;
  email: string;
  emergency_contact: string;
  position: string;
  subject: string;
  hire_date: string;
  departure_date: string;
  enrollment_date: string;
  reason: string;
  archived_at: string;
  archived_by: string;
  username: string;
  role_field: string;
  was_active: string;
  salary: string;
  insurance_pct: string;
  insurance_held: string;
  insurance_paid_out: string;
  insurance_paid_out_amount: string;
  insurance_paid_out_at: string;
  // teaching specifics
  curriculum: string;
  authored: string;
  homework: string;
  assignments: string;
  grades: string;
  reports: string;
  weekly_summaries: string;
  academic_posts: string;
  // transport specifics
  bus: string;
  vehicle: string;
  license: string;
  students_transported: string;
  ride_records: string;
  // salary history
  salary_history: string;
  col_date: string;
  col_gross: string;
  col_insurance: string;
  col_net: string;
  col_period: string;
  total_gross: string;
  total_insurance: string;
  total_net: string;
  // documents
  no_documents: string;
  docs_col_category: string;
  docs_col_number: string;
  docs_col_issued: string;
  docs_col_expires: string;
  docs_col_status: string;
  scan_status_clean: string;
  scan_status_pending: string;
  scan_status_infected: string;
  scan_status_skipped: string;
  redacted: string;
  // student specifics
  parent_name: string;
  parent_phone: string;
  class: string;
  classes_attended: string;
  no_grades: string;
}

export const L: Record<Lang, Labels> = {
  en: {
    archived_employee_record: 'Archived Employee Record',
    archived_student_record: 'Archived Student Record',
    generated: 'Generated',
    by: 'by',
    archive_id: 'Archive ID',
    schema_version: 'Schema version',
    page: 'Page',
    of: 'of',
    em_dash: '—',
    yes: 'Yes',
    no: 'No',
    role_teacher: 'Teacher',
    role_driver: 'Driver',
    role_staff: 'Staff',
    role_supervisor: 'Supervisor',
    role_admin: 'Administrator',
    role_reception: 'Receptionist',
    role_accountant: 'Accountant',
    reason_resigned: 'Resigned',
    reason_terminated: 'Terminated',
    reason_contract_ended: 'Contract ended',
    reason_retired: 'Retired',
    reason_transferred: 'Transferred',
    reason_other: 'Other',
    reason_graduated: 'Graduated',
    reason_left: 'Left school',
    reason_relocated: 'Relocated',
    reason_other_student: 'Other',
    sec_personal: 'Personal',
    sec_contact: 'Contact',
    sec_employment: 'Employment',
    sec_teaching: 'Teaching',
    sec_transport: 'Transport',
    sec_compensation: 'Compensation',
    sec_account: 'Account',
    sec_documents: 'Documents',
    sec_enrollment: 'Enrollment',
    sec_parent: 'Parent / guardian',
    sec_class_history: 'Class history',
    sec_academic_progression: 'Academic progression',
    sec_grades: 'Grades',
    status_enrolled: 'Enrolled',
    status_promoted: 'Promoted',
    status_retained: 'Retained',
    status_on_leave: 'On leave',
    status_withdrew: 'Withdrew',
    status_transferred: 'Transferred',
    status_graduated: 'Graduated',
    full_name: 'Full name',
    date_of_birth: 'Date of birth',
    age: 'Age',
    nationality: 'Nationality',
    national_id: 'National / Civil ID',
    gender: 'Gender',
    marital_status: 'Marital status',
    address: 'Address',
    phone: 'Phone',
    alt_phone: 'Alt phone',
    email: 'Email',
    emergency_contact: 'Emergency contact',
    position: 'Position',
    subject: 'Subject',
    hire_date: 'Hired',
    departure_date: 'Departed',
    enrollment_date: 'Enrolled',
    reason: 'Reason',
    archived_at: 'Archived at',
    archived_by: 'Archived by',
    username: 'Username',
    role_field: 'Role',
    was_active: 'Active at archive',
    salary: 'Salary',
    insurance_pct: 'Insurance %',
    insurance_held: 'Insurance held',
    insurance_paid_out: 'Insurance paid out',
    insurance_paid_out_amount: 'Insurance amount',
    insurance_paid_out_at: 'Paid out on',
    curriculum: 'Curriculum',
    authored: 'Authored',
    homework: 'homework',
    assignments: 'assignments',
    grades: 'grades',
    reports: 'reports',
    weekly_summaries: 'weekly summaries',
    academic_posts: 'posts',
    bus: 'Bus',
    vehicle: 'Vehicle',
    license: 'License',
    students_transported: 'Students transported',
    ride_records: 'Ride records',
    salary_history: 'Salary history',
    col_date: 'Date',
    col_gross: 'Gross',
    col_insurance: 'Insurance',
    col_net: 'Net',
    col_period: 'Period',
    total_gross: 'Total gross',
    total_insurance: 'Total insurance',
    total_net: 'Total net',
    no_documents: 'No documents on file',
    docs_col_category: 'Category',
    docs_col_number: 'Number',
    docs_col_issued: 'Issued',
    docs_col_expires: 'Expires',
    docs_col_status: 'Scan',
    scan_status_clean: 'Clean',
    scan_status_pending: 'Pending',
    scan_status_infected: 'Infected',
    scan_status_skipped: 'Skipped',
    redacted: 'Redacted',
    parent_name: 'Parent name',
    parent_phone: 'Parent phone',
    class: 'Class',
    classes_attended: 'Classes attended',
    no_grades: 'No grades recorded',
  },
  ar: {
    archived_employee_record: 'سجل موظف مؤرشف',
    archived_student_record: 'سجل طالب مؤرشف',
    generated: 'أُنشئ في',
    by: 'بواسطة',
    archive_id: 'رقم الأرشيف',
    schema_version: 'إصدار المخطط',
    page: 'صفحة',
    of: 'من',
    em_dash: '—',
    yes: 'نعم',
    no: 'لا',
    role_teacher: 'معلم',
    role_driver: 'سائق',
    role_staff: 'موظف إداري',
    role_supervisor: 'مشرف',
    role_admin: 'مدير',
    role_reception: 'موظف استقبال',
    role_accountant: 'محاسب',
    reason_resigned: 'استقالة',
    reason_terminated: 'إنهاء الخدمة',
    reason_contract_ended: 'انتهاء العقد',
    reason_retired: 'تقاعد',
    reason_transferred: 'نقل',
    reason_other: 'أخرى',
    reason_graduated: 'تخرج',
    reason_left: 'ترك المدرسة',
    reason_relocated: 'انتقال',
    reason_other_student: 'أخرى',
    sec_personal: 'بيانات شخصية',
    sec_contact: 'الاتصال',
    sec_employment: 'الوظيفة',
    sec_teaching: 'التدريس',
    sec_transport: 'النقل',
    sec_compensation: 'التعويضات',
    sec_account: 'الحساب',
    sec_documents: 'المستندات',
    sec_enrollment: 'التسجيل',
    sec_parent: 'ولي الأمر',
    sec_class_history: 'سجل الفصول',
    sec_academic_progression: 'المسار الأكاديمي',
    sec_grades: 'الدرجات',
    status_enrolled: 'مسجَّل',
    status_promoted: 'انتقل للصف التالي',
    status_retained: 'أعاد الصف',
    status_on_leave: 'في إجازة',
    status_withdrew: 'انسحب',
    status_transferred: 'منقول',
    status_graduated: 'متخرج',
    full_name: 'الاسم الكامل',
    date_of_birth: 'تاريخ الميلاد',
    age: 'العمر',
    nationality: 'الجنسية',
    national_id: 'الرقم الوطني / المدني',
    gender: 'الجنس',
    marital_status: 'الحالة الاجتماعية',
    address: 'العنوان',
    phone: 'الهاتف',
    alt_phone: 'هاتف بديل',
    email: 'البريد الإلكتروني',
    emergency_contact: 'جهة اتصال للطوارئ',
    position: 'المنصب',
    subject: 'المادة',
    hire_date: 'تاريخ التعيين',
    departure_date: 'تاريخ المغادرة',
    enrollment_date: 'تاريخ التسجيل',
    reason: 'السبب',
    archived_at: 'تاريخ الأرشفة',
    archived_by: 'أرشف بواسطة',
    username: 'اسم المستخدم',
    role_field: 'الدور',
    was_active: 'نشط عند الأرشفة',
    salary: 'الراتب',
    insurance_pct: 'نسبة التأمين',
    insurance_held: 'تأمين محتجز',
    insurance_paid_out: 'تأمين مدفوع',
    insurance_paid_out_amount: 'مبلغ التأمين',
    insurance_paid_out_at: 'تاريخ السداد',
    curriculum: 'المنهج',
    authored: 'تم تأليف',
    homework: 'واجب',
    assignments: 'مهمة',
    grades: 'درجة',
    reports: 'تقرير',
    weekly_summaries: 'ملخص أسبوعي',
    academic_posts: 'منشور',
    bus: 'الحافلة',
    vehicle: 'المركبة',
    license: 'الرخصة',
    students_transported: 'الطلاب المنقولون',
    ride_records: 'سجلات الرحلات',
    salary_history: 'سجل الرواتب',
    col_date: 'التاريخ',
    col_gross: 'الإجمالي',
    col_insurance: 'التأمين',
    col_net: 'الصافي',
    col_period: 'الفترة',
    total_gross: 'إجمالي الإجمالي',
    total_insurance: 'إجمالي التأمين',
    total_net: 'إجمالي الصافي',
    no_documents: 'لا توجد مستندات',
    docs_col_category: 'الفئة',
    docs_col_number: 'الرقم',
    docs_col_issued: 'تاريخ الإصدار',
    docs_col_expires: 'تاريخ الانتهاء',
    docs_col_status: 'الفحص',
    scan_status_clean: 'نظيف',
    scan_status_pending: 'قيد الفحص',
    scan_status_infected: 'مصاب',
    scan_status_skipped: 'تم التخطي',
    redacted: 'محرر',
    parent_name: 'اسم ولي الأمر',
    parent_phone: 'هاتف ولي الأمر',
    class: 'الصف',
    classes_attended: 'الصفوف الملتحق بها',
    no_grades: 'لا توجد درجات مسجلة',
  },
  ku: {
    archived_employee_record: 'تۆماری کارمەندی ئەرشیفکراو',
    archived_student_record: 'تۆماری خوێندکاری ئەرشیفکراو',
    generated: 'دروستکراوە لە',
    by: 'لەلایەن',
    archive_id: 'ژمارەی ئەرشیف',
    schema_version: 'وەشانی نەخشە',
    page: 'پەڕە',
    of: 'لە',
    em_dash: '—',
    yes: 'بەڵێ',
    no: 'نەخێر',
    role_teacher: 'مامۆستا',
    role_driver: 'شۆفێر',
    role_staff: 'کارمەند',
    role_supervisor: 'سەرپەرشتیار',
    role_admin: 'بەڕێوەبەر',
    role_reception: 'پێشوازیکار',
    role_accountant: 'ژمێریار',
    reason_resigned: 'دەستلەکارکێشانەوە',
    reason_terminated: 'کۆتاییپێهێنانی خزمەت',
    reason_contract_ended: 'کۆتاییهاتنی گرێبەست',
    reason_retired: 'خانەنشینبوون',
    reason_transferred: 'گواستنەوە',
    reason_other: 'هیتر',
    reason_graduated: 'دەرچوون',
    reason_left: 'جێهێشتنی قوتابخانە',
    reason_relocated: 'گواستنەوە',
    reason_other_student: 'هیتر',
    sec_personal: 'زانیاری کەسی',
    sec_contact: 'پەیوەندی',
    sec_employment: 'کارکردن',
    sec_teaching: 'وانەوتنەوە',
    sec_transport: 'گواستنەوە',
    sec_compensation: 'پاداشت',
    sec_account: 'هەژمار',
    sec_documents: 'بەڵگەنامەکان',
    sec_enrollment: 'تۆمارکردن',
    sec_parent: 'دایک یان باوک',
    sec_class_history: 'مێژووی پۆلەکان',
    sec_academic_progression: 'پێشکەوتنی خوێندن',
    sec_grades: 'نمرەکان',
    status_enrolled: 'تۆمارکراو',
    status_promoted: 'پاژۆ بۆ پۆلی دواتر',
    status_retained: 'پۆل دووبارە کردنەوە',
    status_on_leave: 'لە مۆڵەتدا',
    status_withdrew: 'دەرچوون',
    status_transferred: 'گواستراوەتەوە',
    status_graduated: 'دەرچوو',
    full_name: 'ناوی تەواو',
    date_of_birth: 'بەرواری لەدایکبوون',
    age: 'تەمەن',
    nationality: 'هاوڵاتیبوون',
    national_id: 'ناسنامەی نیشتمانی',
    gender: 'ڕەگەز',
    marital_status: 'باری هاوسەرگیری',
    address: 'ناونیشان',
    phone: 'ژمارەی مۆبایل',
    alt_phone: 'ژمارەی جێگرەوە',
    email: 'ئیمەیڵ',
    emergency_contact: 'پەیوەندیی فریاگوزاری',
    position: 'پلە',
    subject: 'بابەت',
    hire_date: 'بەرواری دامەزراندن',
    departure_date: 'بەرواری ڕۆیشتن',
    enrollment_date: 'بەرواری تۆمارکردن',
    reason: 'هۆکار',
    archived_at: 'بەرواری ئەرشیفکردن',
    archived_by: 'ئەرشیفکراوە لەلایەن',
    username: 'ناوی بەکارهێنەر',
    role_field: 'ڕۆڵ',
    was_active: 'چالاک لە کاتی ئەرشیف',
    salary: 'مووچە',
    insurance_pct: 'ڕێژەی بیمە',
    insurance_held: 'بیمەی هەڵگیراو',
    insurance_paid_out: 'بیمەی دراو',
    insurance_paid_out_amount: 'بڕی بیمە',
    insurance_paid_out_at: 'بەرواری دانەوە',
    curriculum: 'بەرنامەی وانە',
    authored: 'دروستکراو',
    homework: 'ماڵئاوەزی',
    assignments: 'ئەرک',
    grades: 'نمرە',
    reports: 'ڕاپۆرت',
    weekly_summaries: 'پوختەی هەفتانە',
    academic_posts: 'بابەت',
    bus: 'ئوتومبیل',
    vehicle: 'وەسیلە',
    license: 'مۆڵەت',
    students_transported: 'خوێندکارانی گواستراوە',
    ride_records: 'تۆمارەکانی گەشت',
    salary_history: 'مێژووی مووچە',
    col_date: 'بەروار',
    col_gross: 'گشتی',
    col_insurance: 'بیمە',
    col_net: 'پاک',
    col_period: 'ماوە',
    total_gross: 'کۆی گشتی',
    total_insurance: 'کۆی بیمە',
    total_net: 'کۆی پاک',
    no_documents: 'هیچ بەڵگەنامەیەک نییە',
    docs_col_category: 'پۆل',
    docs_col_number: 'ژمارە',
    docs_col_issued: 'بەرواری دەرکردن',
    docs_col_expires: 'بەرواری کۆتایی',
    docs_col_status: 'پشکنین',
    scan_status_clean: 'پاک',
    scan_status_pending: 'لە چاوەڕوانیدا',
    scan_status_infected: 'گیراو',
    scan_status_skipped: 'تێپەڕێنراو',
    redacted: 'سڕاوەتەوە',
    parent_name: 'ناوی دایک یان باوک',
    parent_phone: 'ژمارەی دایک یان باوک',
    class: 'پۆل',
    classes_attended: 'پۆلەکانی ئامادەبوو',
    no_grades: 'هیچ نمرەیەک تۆمار نەکراوە',
  },
};

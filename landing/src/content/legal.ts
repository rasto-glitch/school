// Legal content for /privacy and /terms pages.
// Each section becomes an <h2> + paragraphs. List items render as bullets.

export type Section = {
  heading: string;
  paragraphs?: string[];
  list?: string[];
};

export type LegalDoc = {
  title: string;
  lastUpdated: string;
  sections: Section[];
};

export type Lang = 'en' | 'ar' | 'ku';

const LAST_UPDATED = '2026-04-24';

// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY POLICY
// ─────────────────────────────────────────────────────────────────────────────

const privacyEn: LegalDoc = {
  title: 'Privacy Policy',
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: '1. About this policy',
      paragraphs: [
        'This Privacy Policy explains how Scholify ("we", "us") handles information when a school uses our school-management platform. Scholify is operated as a service to schools in the Kurdistan Region of Iraq and partner regions. It applies to our web apps, mobile apps, and the academic portal.',
        'Scholify is operated by Rast Naser as an individual developer based in the Kurdistan Region of Iraq. Questions, data-subject requests, and legal notices can be directed to the addresses in the Contact section below.',
      ],
    },
    {
      heading: '2. Standards we follow',
      paragraphs: [
        'Iraq does not currently have a single, comprehensive federal data-protection law. We voluntarily align our practices with widely accepted international standards — most notably the principles of the EU General Data Protection Regulation (GDPR) — including data minimization, purpose limitation, security, and giving people meaningful control over information about them.',
        'Where a school operates under stricter local rules, the school remains responsible for its own sector-specific compliance. We support schools in meeting those obligations.',
      ],
    },
    {
      heading: '3. Who we serve',
      paragraphs: [
        'Scholify is provided to schools. The people who use it are: administrators, teachers, supervisors, parents, drivers, and reception staff. Students do not receive their own accounts. Information about students is entered by school staff and shown only to the appropriate roles within that school.',
      ],
    },
    {
      heading: '4. Information we handle',
      list: [
        'Account information: name, username, role, school, language preference, password (stored hashed, never in plain text).',
        'Generated information: attendance, grades, reports, homework, assignments, announcements, chat messages, appointments.',
        'Location data: drivers share GPS while a trip is active; parents may set a home pickup point. We do not track parents or staff in the background.',
        'Mobile device information: a push-notification token so we can deliver alerts.',
        'Technical information: IP address, browser/device type, and basic logs needed to keep the service running and secure.',
        'Student information entered by the school: name, class, guardian details, attendance, grades, and other academic records.',
      ],
    },
    {
      heading: '5. How we use information',
      paragraphs: [
        'We use information to operate the service the school has asked for: to authenticate users, deliver messages and alerts, calculate grades and reports, show bus location to the right parents at the right time, and keep the platform secure.',
      ],
      list: [
        'We do not sell information.',
        'We do not show advertising and we do not share information with advertisers.',
        'We do not use personal information to train AI models.',
        'We do not mix one school\'s data with another\'s. Every record is scoped to the school it belongs to.',
      ],
    },
    {
      heading: '6. Children\'s data',
      paragraphs: [
        'Scholify handles information about children because schools handle information about children. We treat that information with care: it is isolated per school, restricted by role, and never used for any purpose beyond running the school.',
      ],
    },
    {
      heading: '7. How data is shared',
      paragraphs: [
        'We use a small number of trusted infrastructure providers to run the service. They process data only on our instructions:',
      ],
      list: [
        'Supabase — database and file storage.',
        'Railway — backend hosting.',
        'Vercel — web hosting for the public site, school portal, and academic portal.',
        'Expo — mobile app delivery and push notifications.',
        'Google Maps — map tiles for bus tracking.',
        'Resend — outbound email for demo requests, partner applications, and password-reset notifications.',
      ],
    },
    {
      heading: '8. Where data is stored',
      paragraphs: [
        'Data is stored on cloud infrastructure operated by the providers above, primarily in data centers located in the United States and Europe. Connections are encrypted in transit.',
      ],
    },
    {
      heading: '9. Security',
      paragraphs: [
        'We protect data with:',
      ],
      list: [
        'HTTPS/TLS for every connection between apps and our servers.',
        'Bcrypt password hashing (passwords are never stored in plain text).',
        'Signed JWT sessions that can be invalidated by an administrator.',
        'Per-request school-scoping checks so one school cannot read another school\'s data.',
        'Automatic session invalidation when a school changes its security-relevant settings.',
      ],
      // continued below
    },
    {
      heading: '10. Data retention',
      list: [
        'Active accounts: data is kept while the account is active.',
        'Archived students: when a student leaves, the school may archive them. Archived records are kept so the school has a historical record.',
        'Deleted records: when a school deletes a record, it is removed from the live database within 30 days, except where law requires retention.',
        'Chat messages: kept until a participant deletes them or the school removes the account.',
        'Bus GPS: live position is shown in real time and is not retained as a long-term location history.',
      ],
    },
    {
      heading: '11. Our commitments to you',
      paragraphs: [
        'Even where local law does not require it, we commit to honor reasonable requests to:',
      ],
      list: [
        'Access the personal information we hold about you.',
        'Correct information that is inaccurate.',
        'Delete information, subject to the school\'s record-keeping needs.',
        'Receive a copy of your information in a portable format.',
        'Object to a specific use of your information.',
      ],
    },
    {
      heading: '12. Cookies and similar technologies',
      paragraphs: [
        'Our web apps use only essential storage needed to keep you signed in and remember your language preference. We do not use third-party tracking or advertising cookies.',
      ],
    },
    {
      heading: '13. Schools\' separate responsibilities',
      paragraphs: [
        'Each school decides which staff have which role and what information is entered into the platform. Sector-specific obligations (such as education-records rules) remain the responsibility of the school.',
      ],
    },
    {
      heading: '14. Changes to this policy',
      paragraphs: [
        'We may update this policy as the service evolves. Material changes will be communicated through the platform.',
      ],
    },
    {
      heading: '15. Contact',
      paragraphs: [
        'Questions about privacy: privacy@scholify.krd',
        'General contact: onboarding@scholify.krd',
      ],
    },
  ],
};

const privacyAr: LegalDoc = {
  title: 'سياسة الخصوصية',
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: '١. حول هذه السياسة',
      paragraphs: [
        'توضح سياسة الخصوصية هذه كيف تتعامل Scholify ("نحن") مع المعلومات عند استخدام مدرسة لمنصتنا لإدارة المدارس. تُقدَّم Scholify كخدمة للمدارس في إقليم كردستان العراق والمناطق الشريكة. وتنطبق على تطبيقات الويب وتطبيقات الهاتف والبوابة الأكاديمية.',
        'تُشغَّل Scholify من قِبَل راست ناصر بصفته مطوّراً فردياً مقيماً في إقليم كردستان العراق. يمكن توجيه الاستفسارات وطلبات أصحاب البيانات والإشعارات القانونية إلى العناوين الواردة في قسم التواصل أدناه.',
      ],
    },
    {
      heading: '٢. المعايير التي نتبعها',
      paragraphs: [
        'لا يوجد حالياً في العراق قانون اتحادي شامل واحد لحماية البيانات. ونلتزم طوعياً بمواءمة ممارساتنا مع المعايير الدولية المعتمدة على نطاق واسع — وأبرزها مبادئ اللائحة العامة لحماية البيانات في الاتحاد الأوروبي (GDPR) — بما في ذلك تقليل البيانات وتحديد الغرض والأمان ومنح الأشخاص تحكماً فعلياً في المعلومات الخاصة بهم.',
        'وعندما تعمل المدرسة بموجب قواعد محلية أكثر صرامة، تظل المدرسة مسؤولة عن امتثالها القطاعي. ونحن ندعم المدارس في الوفاء بهذه الالتزامات.',
      ],
    },
    {
      heading: '٣. من نخدم',
      paragraphs: [
        'تُقدَّم Scholify للمدارس. ومستخدموها هم: المدراء، والمعلمون، والمشرفون، وأولياء الأمور، والسائقون، وموظفو الاستقبال. لا يحصل الطلاب على حسابات خاصة بهم. وتُدخل معلومات الطلاب من قِبَل موظفي المدرسة وتُعرض فقط على الأدوار المختصة داخل تلك المدرسة.',
      ],
    },
    {
      heading: '٤. المعلومات التي نتعامل معها',
      list: [
        'معلومات الحساب: الاسم، اسم المستخدم، الدور، المدرسة، اللغة المفضلة، كلمة المرور (تُخزَّن مُجزَّأة ولا تُحفظ كنص ظاهر).',
        'المعلومات الناتجة عن الاستخدام: الحضور، الدرجات، التقارير، الواجبات، التكاليف، الإعلانات، رسائل المحادثات، المواعيد.',
        'بيانات الموقع: يُشارك السائقون موقع GPS أثناء تنفيذ الرحلة فقط؛ ويمكن لولي الأمر تحديد نقطة استلام في المنزل. ولا نقوم بتتبع أولياء الأمور أو الموظفين في الخلفية.',
        'معلومات جهاز الهاتف: رمز الإشعارات لتمكيننا من إيصال التنبيهات.',
        'المعلومات التقنية: عنوان IP، نوع المتصفح/الجهاز، وسجلات أساسية لازمة لتشغيل الخدمة وتأمينها.',
        'معلومات الطلاب التي تُدخلها المدرسة: الاسم، الصف، بيانات ولي الأمر، الحضور، الدرجات، وسجلات أكاديمية أخرى.',
      ],
    },
    {
      heading: '٥. كيف نستخدم المعلومات',
      paragraphs: [
        'نستخدم المعلومات لتشغيل الخدمة التي طلبتها المدرسة: للمصادقة على المستخدمين، وإيصال الرسائل والتنبيهات، وحساب الدرجات والتقارير، وإظهار موقع الباص لولي الأمر المعنيّ في الوقت المناسب، والحفاظ على أمان المنصة.',
      ],
      list: [
        'نحن لا نبيع المعلومات.',
        'نحن لا نعرض إعلانات ولا نشارك المعلومات مع المعلنين.',
        'نحن لا نستخدم المعلومات الشخصية لتدريب نماذج الذكاء الاصطناعي.',
        'نحن لا نمزج بيانات مدرسة مع بيانات مدرسة أخرى. كل سجل مرتبط بالمدرسة التي يخصّها.',
      ],
    },
    {
      heading: '٦. بيانات الأطفال',
      paragraphs: [
        'تتعامل Scholify مع معلومات الأطفال لأن المدارس تتعامل مع معلومات الأطفال. ونتعامل مع هذه المعلومات بعناية: فهي معزولة لكل مدرسة، ومقيّدة حسب الدور، ولا تُستخدم لأي غرض خارج إدارة المدرسة.',
      ],
    },
    {
      heading: '٧. كيف تُشارَك البيانات',
      paragraphs: [
        'نستخدم عدداً محدوداً من مزوّدي البنية التحتية الموثوقين لتشغيل الخدمة. وهم يعالجون البيانات بناءً على تعليماتنا فقط:',
      ],
      list: [
        'Supabase — قاعدة البيانات وتخزين الملفات.',
        'Railway — استضافة الواجهة الخلفية.',
        'Vercel — استضافة الموقع العام وبوابة المدرسة والبوابة الأكاديمية.',
        'Expo — توصيل تطبيق الهاتف والإشعارات.',
        'Google Maps — خرائط لتتبع الباص.',
        'Resend — البريد الصادر لطلبات العرض التجريبي وطلبات الشراكة وإشعارات إعادة تعيين كلمة المرور.',
      ],
    },
    {
      heading: '٨. مكان تخزين البيانات',
      paragraphs: [
        'تُخزَّن البيانات على بنية تحتية سحابية يديرها المزوّدون أعلاه، وفي الغالب في مراكز بيانات في الولايات المتحدة وأوروبا. وجميع الاتصالات مشفّرة أثناء النقل.',
      ],
    },
    {
      heading: '٩. الأمان',
      paragraphs: [
        'نحمي البيانات بـ:',
      ],
      list: [
        'HTTPS/TLS لكل اتصال بين التطبيقات وخوادمنا.',
        'تجزئة كلمات المرور بـ Bcrypt (لا تُخزَّن كلمات المرور كنص ظاهر).',
        'جلسات JWT موقّعة يمكن للمدير إبطالها.',
        'فحوصات نطاق المدرسة في كل طلب لضمان عدم قراءة بيانات مدرسة من قِبَل مدرسة أخرى.',
        'إبطال تلقائي للجلسات عند تغيير المدرسة لإعدادات حساسة من ناحية الأمان.',
      ],
    },
    {
      heading: '١٠. الاحتفاظ بالبيانات',
      list: [
        'الحسابات النشطة: تُحفظ البيانات طالما الحساب نشط.',
        'الطلاب المؤرشفون: عند مغادرة الطالب، يجوز للمدرسة أرشفته. وتُحفظ السجلات المؤرشفة كسجل تاريخي للمدرسة.',
        'السجلات المحذوفة: عند حذف المدرسة لسجل، يُزال من قاعدة البيانات الفعلية خلال ٣٠ يوماً، إلا حيث يُلزم القانون بالاحتفاظ.',
        'رسائل المحادثات: تُحفظ حتى يحذفها أحد المشاركين أو تُغلق المدرسة الحساب.',
        'بيانات GPS للباصات: يُعرض الموقع لحظياً، ولا يُحتفظ بسجل تاريخي للمواقع.',
      ],
    },
    {
      heading: '١١. التزاماتنا تجاهك',
      paragraphs: [
        'حتى عندما لا يُلزم القانون المحلي بذلك، نلتزم بتلبية الطلبات المعقولة لـ:',
      ],
      list: [
        'الاطلاع على المعلومات الشخصية التي نحتفظ بها عنك.',
        'تصحيح المعلومات غير الدقيقة.',
        'حذف المعلومات، مع مراعاة احتياجات المدرسة لحفظ السجلات.',
        'الحصول على نسخة من معلوماتك بصيغة قابلة للنقل.',
        'الاعتراض على استخدام محدد لمعلوماتك.',
      ],
    },
    {
      heading: '١٢. ملفات تعريف الارتباط والتقنيات المماثلة',
      paragraphs: [
        'تستخدم تطبيقاتنا تخزيناً ضرورياً فقط للحفاظ على تسجيل دخولك وتذكّر لغتك المفضلة. ولا نستخدم ملفات تعريف ارتباط لتتبع طرف ثالث أو للإعلانات.',
      ],
    },
    {
      heading: '١٣. مسؤوليات المدارس المنفصلة',
      paragraphs: [
        'تقرر كل مدرسة من هم الموظفون ومن لهم أي دور وما المعلومات التي تُدخل في المنصة. وتظل الالتزامات القطاعية (مثل قواعد السجلات التعليمية) من مسؤولية المدرسة.',
      ],
    },
    {
      heading: '١٤. تغييرات على هذه السياسة',
      paragraphs: [
        'قد نقوم بتحديث هذه السياسة مع تطور الخدمة. وسيتم إبلاغ التغييرات الجوهرية عبر المنصة.',
      ],
    },
    {
      heading: '١٥. التواصل',
      paragraphs: [
        'استفسارات الخصوصية: privacy@scholify.krd',
        'التواصل العام: onboarding@scholify.krd',
      ],
    },
  ],
};

const privacyKu: LegalDoc = {
  title: 'سیاسەتی تایبەتمەندی',
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: '١. دەربارەی ئەم سیاسەتە',
      paragraphs: [
        'ئەم سیاسەتی تایبەتمەندییە ڕوون دەکاتەوە کە چۆن Scholify ("ئێمە") مامەڵە لەگەڵ زانیاریدا دەکات کاتێک قوتابخانەیەک پلاتفۆڕمی بەڕێوەبردنی قوتابخانەی ئێمە بەکار دەهێنێت. Scholify وەک خزمەتگوزارییەک پێشکەش بە قوتابخانەکانی هەرێمی کوردستانی عێراق و ناوچە هاوبەشەکان دەکرێت. ئەم سیاسەتە بۆ ئەپلیکەیشنی وێب، ئەپلیکەیشنی مۆبایل و دەرگای ئەکادیمی جێبەجێ دەبێت.',
        'Scholify لەلایەن ڕاست ناسرەوە وەک گەشەپێدەرێکی تاکەکەسی لە هەرێمی کوردستانی عێراق بەڕێوە دەبرێت. پرسیار، داواکاریەکانی خاوەنی داتا، و ئاگاداریە یاساییەکان دەکرێت بنێردرێن بۆ ئەو ناونیشانانەی لە بەشی پەیوەندی لە خوارەوە.',
      ],
    },
    {
      heading: '٢. ئەو ستانداردانەی شوێنیان دەکەوین',
      paragraphs: [
        'لە ئێستادا عێراق یاسایەکی فیدراڵی تەواوی پاراستنی داتای نییە. ئێمە بە ئاگاوە ڕێوشوێنەکانمان لەگەڵ ستانداردە نێودەوڵەتییە بەرفراوانەکاندا ڕێک دەخەین — بە تایبەتی پرەنسیپەکانی یاسای گشتی پاراستنی داتای یەکێتیی ئەوروپا (GDPR) — بە کۆکردنەوەی کەمی داتا، سنووردارکردنی مەبەست، ئاسایش و دانی کۆنترۆڵی واقیعی بە کەسەکان بەسەر زانیاری خۆیاندا.',
        'ئەگەر قوتابخانەیەک ژێر یاسا ناوخۆییە توندوتۆڵترەکاندا کاربکات، بەرپرسیارێتی پابەندبوونی کەرتیی خۆی لەسەر قوتابخانە دەمێنێتەوە. ئێمە پاڵپشتی قوتابخانەکان دەکەین بۆ پابەندبوون بەو ئەرکانە.',
      ],
    },
    {
      heading: '٣. کێ خزمەت دەکەین',
      paragraphs: [
        'Scholify بۆ قوتابخانەکان دابین دەکرێت. بەکارهێنەرانی ئەمانەن: بەڕێوەبەران، مامۆستایان، سەرپەرشتیاران، دایک و باوکان، شۆفێرەکان و کارمەندانی پێشوازی. قوتابیان هەژماری تایبەت بە خۆیان وەرناگرن. زانیاری قوتابیان لەلایەن کارمەندانی قوتابخانەوە دەخرێتە ناو سیستم و تەنها بۆ ڕۆڵە پەیوەندیدارەکان لەناو ئەو قوتابخانەدا پیشان دەدرێت.',
      ],
    },
    {
      heading: '٤. ئەو زانیاریانەی مامەڵەی لەگەڵدا دەکەین',
      list: [
        'زانیاری هەژمار: ناو، ناوی بەکارهێنەر، ڕۆڵ، قوتابخانە، زمانی هەڵبژێردراو، تێپەڕەوشە (هەش کراوە دەخرێتە سەر، هەرگیز وەک دەقی ساف نییە).',
        'زانیاری دروستکراو لە بەکارهێنانەوە: ئامادەبوون، نمرەکان، ڕاپۆرتەکان، ئەرکی ماڵەوە، تکالیف، ڕاگەیاندنەکان، نامەکانی چاتەکان، ژووانەکان.',
        'داتای شوێن: شۆفێرەکان شوێنی GPS تەنها لە کاتی گەشتدا هاوبەش دەکەن؛ دایک و باوکان دەتوانن خاڵێکی وەرگرتن لە ماڵەوە دیاری بکەن. ئێمە لە پشتەوە دایک و باوکان یان کارمەندان شوێنیان لێ ناگرین.',
        'زانیاری ئامێری مۆبایل: تۆکنی push بۆ گەیاندنی ئاگادارکردنەوەکان.',
        'زانیاری تەکنیکی: ناونیشانی IP، جۆری وێبگەڕ/ئامێر، و لۆگی بنەڕەتی پێویست بۆ کارکردن و ئاسایشی خزمەتگوزاری.',
        'زانیاری قوتابی کە لەلایەن قوتابخانەوە دەخرێتە سەر: ناو، پۆل، زانیاری سەرپەرشتیار، ئامادەبوون، نمرەکان و تۆمارە ئەکادیمییەکانی تر.',
      ],
    },
    {
      heading: '٥. چۆن زانیاری بەکار دەهێنین',
      paragraphs: [
        'زانیاری بەکار دەهێنین بۆ ئەنجامدانی ئەو خزمەتگوزارییەی قوتابخانە داوای کردووە: بۆ پشتڕاستکردنەوەی بەکارهێنەران، گەیاندنی نامە و ئاگادارکردنەوەکان، ژماردنی نمرە و ڕاپۆرتەکان، پیشاندانی شوێنی پاسەکە بە دایک و باوکی پەیوەندیدار لە کاتی گونجاو، و پاراستنی ئاسایشی پلاتفۆڕم.',
      ],
      list: [
        'ئێمە زانیاری نافرۆشین.',
        'ئێمە ڕیکلام پیشان نادەین و زانیاری لەگەڵ ڕیکلامکارەکاندا هاوبەش ناکەین.',
        'ئێمە زانیاری کەسی بۆ ڕاهێنانی مۆدێلەکانی AI بەکار ناهێنین.',
        'ئێمە داتای قوتابخانەیەک تێکەڵ ناکەین لەگەڵ داتای قوتابخانەیەکی تردا. هەموو تۆمارێک بە قوتابخانەی خۆیەوە بەستراوەتەوە.',
      ],
    },
    {
      heading: '٦. داتای منداڵان',
      paragraphs: [
        'Scholify مامەڵە لەگەڵ زانیاری منداڵاندا دەکات چونکە قوتابخانەکان مامەڵە لەگەڵ زانیاری منداڵاندا دەکەن. ئێمە بە وریاییەوە مامەڵەی لەگەڵدا دەکەین: بۆ هەر قوتابخانەیەک جیاوازە، بەپێی ڕۆڵ سنووردارە، و هەرگیز بۆ هیچ مەبەستێکی دەرەوەی بەڕێوەبردنی قوتابخانە بەکار نایەت.',
      ],
    },
    {
      heading: '٧. چۆن داتا هاوبەش دەکرێت',
      paragraphs: [
        'ئێمە ژمارەیەکی کەمی دابینکەرانی متمانەپێکراوی بنیاتنانی ئامێر بەکار دەهێنین بۆ کارکردنی خزمەتگوزاری. ئەوان داتا تەنها بەپێی ڕێنماییەکانی ئێمە پرۆسێس دەکەن:',
      ],
      list: [
        'Supabase — بنکەی داتا و گەنجینەی فایل.',
        'Railway — هۆستکردنی Backend.',
        'Vercel — هۆستکردنی وێبسایتی گشتی، دەرگای قوتابخانە، و دەرگای ئەکادیمی.',
        'Expo — گەیاندنی ئەپی مۆبایل و push notifications.',
        'Google Maps — نەخشە بۆ گرتنەوەی شوێنی پاسەکە.',
        'Resend — ئیمەیڵی دەرچوون بۆ داواکاری دیمۆ، داواکاری هاوبەشی، و ئاگادارکردنەوەی نوێکردنەوەی تێپەڕەوشە.',
      ],
    },
    {
      heading: '٨. شوێنی هەڵگرتنی داتا',
      paragraphs: [
        'داتا لە بنیاتی هەوری ئەو دابینکەرانەی سەرەوە هەڵدەگیرێت، بە زۆری لە سەنتەرە داتاکانی ویلایەتە یەکگرتووەکان و ئەوروپا. هەموو پەیوەندییەکان لە کاتی گواستنەوەدا کۆد کراون.',
      ],
    },
    {
      heading: '٩. ئاسایش',
      paragraphs: [
        'داتا دەپارێزین بە:',
      ],
      list: [
        'HTTPS/TLS بۆ هەر پەیوەندییەک نێوان ئەپەکان و سێرڤەرەکانمان.',
        'هەش کردنی تێپەڕەوشە بە Bcrypt (تێپەڕەوشە هەرگیز وەک دەقی ساف هەڵناگیرێت).',
        'دانیشتنەکانی JWT کە دەکرێت لەلایەن بەڕێوەبەرەوە بسڕێنەوە.',
        'پشکنینی سنووری قوتابخانە لە هەر داواکارییەکدا تا قوتابخانەیەک نەتوانێت داتای قوتابخانەیەکی تر بخوێنێتەوە.',
        'سڕینەوەی خۆکارانەی دانیشتنەکان کاتێک قوتابخانە ڕێکخستنە حەساسەکانی ئاسایش بگۆڕێت.',
      ],
    },
    {
      heading: '١٠. هێشتنەوەی داتا',
      list: [
        'هەژمارە چالاکەکان: داتا دەهێڵدرێتەوە تا کاتێک هەژمار چالاکە.',
        'قوتابیە ئەرشیفکراوەکان: کاتێک قوتابی دەڕوات، قوتابخانە دەتوانێت ئەرشیفی بکات. تۆمارە ئەرشیفکراوەکان وەک تۆماری مێژوویی قوتابخانە دەپارێزرێن.',
        'تۆمارە سڕاوەکان: کاتێک قوتابخانە تۆمارێک دەسڕێتەوە، لە بنکەی داتای زیندوو لەماوەی ٣٠ ڕۆژدا دەسڕێتەوە، تەنها لەو حاڵەتەی یاسا داوای هێشتنەوەی بکات.',
        'نامەکانی چات: دەهێڵدرێنەوە تا کاتێک یەکێک لە بەشدارەکان دەیسڕێتەوە یان قوتابخانە هەژمار دەسڕێتەوە.',
        'GPS ی پاس: شوێنی زیندوو ڕاستەوخۆ پیشان دەدرێت و وەک مێژووی شوێنی درێژخایەن هەڵناگیرێت.',
      ],
    },
    {
      heading: '١١. بەڵێنەکانمان بۆ تۆ',
      paragraphs: [
        'تەنانەت ئەگەر یاسای ناوخۆیی داوای نەکات، ئێمە بەڵێن دەدەین داواکاریە لۆجیکیەکان بپەسەند بکەین بۆ:',
      ],
      list: [
        'دیتنی ئەو زانیاریە کەسییەی کە لەلامان هەیە دەربارەی تۆ.',
        'ڕاستکردنەوەی زانیاری نادروست.',
        'سڕینەوەی زانیاری، بە ڕەچاوکردنی پێداویستی قوتابخانە بۆ هەڵگرتنی تۆمار.',
        'وەرگرتنی نوسخەیەک لە زانیاری خۆت بە فۆرماتێکی گواستنەوەکراو.',
        'دژبەرەستی بۆ بەکارهێنانێکی دیاریکراوی زانیاری خۆت.',
      ],
    },
    {
      heading: '١٢. کووکیز و تەکنەلۆژیا هاوشێوەکان',
      paragraphs: [
        'وێب ئەپەکانمان تەنها گەنجینەی پێویست بەکار دەهێنن بۆ هێشتنەوەت لە دانیشتن و یادەوەری زمانە هەڵبژێردراوەکەت. ئێمە کووکیزی شوێنپێهەڵگری لایەنی سێیەم یان ڕیکلام بەکار ناهێنین.',
      ],
    },
    {
      heading: '١٣. بەرپرسیارێتیە جیاکانی قوتابخانەکان',
      paragraphs: [
        'هەر قوتابخانەیەک بڕیار دەدات کام کارمەند چ ڕۆڵێکی هەیە و چ زانیاریەک دەخرێتە ناو پلاتفۆڕم. ئەرکە کەرتییەکان (وەک یاساکانی تۆماری پەروەردە) لەسەر قوتابخانە دەمێنێتەوە.',
      ],
    },
    {
      heading: '١٤. گۆڕانکاریەکان لەم سیاسەتەدا',
      paragraphs: [
        'ڕەنگە ئەم سیاسەتە نوێ بکەینەوە لەگەڵ گەشەکردنی خزمەتگوزاری. گۆڕانکارییە گرنگەکان لە ڕێگەی پلاتفۆڕمەوە ڕادەگەیەنرێن.',
      ],
    },
    {
      heading: '١٥. پەیوەندی',
      paragraphs: [
        'پرسیارەکانی تایبەتمەندی: privacy@scholify.krd',
        'پەیوەندی گشتی: onboarding@scholify.krd',
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// TERMS OF SERVICE
// ─────────────────────────────────────────────────────────────────────────────

const termsEn: LegalDoc = {
  title: 'Terms of Service',
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: '1. Agreement',
      paragraphs: [
        'These Terms of Service ("Terms") govern access to and use of Scholify ("the service"). By creating an account, signing in, or otherwise using the service, you agree to these Terms. If you do not agree, do not use the service.',
      ],
    },
    {
      heading: '2. The service',
      paragraphs: [
        'Scholify is a school-management platform offered to schools. It is delivered through web apps, mobile apps, and the academic portal. The school decides which features to enable for its users.',
      ],
    },
    {
      heading: '3. Accounts',
      list: [
        'Accounts are created by your school administrator. Scholify does not allow public sign-up.',
        'You are responsible for keeping your password confidential and for activity that occurs under your account.',
        'If you believe your account has been accessed without your permission, contact your school administrator immediately.',
      ],
    },
    {
      heading: '4. School administrator responsibilities',
      paragraphs: [
        'The school is the controller of all data entered into the platform on its behalf. The school is responsible for:',
      ],
      list: [
        'Choosing which staff have which role.',
        'Ensuring the accuracy of records entered into the platform.',
        'Communicating with parents and staff about how the school uses the platform.',
        'Meeting any sector-specific obligations that apply to the school under local law.',
      ],
    },
    {
      heading: '5. Acceptable use',
      paragraphs: [
        'You agree not to:',
      ],
      list: [
        'Use the service to harass, threaten, or harm any person.',
        'Upload content that is unlawful, abusive, or violates the rights of others.',
        'Attempt to access data belonging to a school other than your own.',
        'Probe, scan, or test the vulnerability of the service without our written permission.',
        'Interfere with the operation of the service or with other users\' use of it.',
        'Use the service to send unsolicited bulk messages.',
      ],
    },
    {
      heading: '6. Your content',
      paragraphs: [
        'You retain all rights to the content you upload (messages, files, posts). You grant us a limited license to host, store, and display that content solely as needed to operate the service for your school.',
      ],
    },
    {
      heading: '7. Subscription and fees',
      paragraphs: [
        'Subscription terms, pricing, and payment are agreed separately between Scholify and each school. Individual users (parents, teachers, staff, drivers) are not charged for using the service.',
      ],
    },
    {
      heading: '8. Privacy',
      paragraphs: [
        'Our handling of personal information is described in the Privacy Policy. By using the service you acknowledge that policy.',
      ],
    },
    {
      heading: '9. Service availability',
      paragraphs: [
        'We work to keep the service running reliably, but we do not guarantee uninterrupted availability. We may schedule maintenance windows or temporarily suspend the service to make changes or address security issues.',
      ],
    },
    {
      heading: '10. Bus tracking — important',
      paragraphs: [
        'The bus tracking feature provides a best-effort estimate of bus location based on GPS data shared by drivers. It depends on cellular connectivity, GPS accuracy, and the driver\'s device. It must not be relied on for safety-critical decisions. Always follow your school\'s standard procedures for student pickup and supervision.',
      ],
    },
    {
      heading: '11. Termination',
      paragraphs: [
        'A school may end its use of the service at any time. Individual accounts can be deactivated by the school\'s administrator. We may suspend or terminate access if these Terms are violated, if there is risk of harm to other users, or if continued provision of the service is not feasible.',
      ],
    },
    {
      heading: '12. Disclaimers',
      paragraphs: [
        'The service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement, to the maximum extent permitted by applicable law.',
      ],
    },
    {
      heading: '13. Limitation of liability',
      paragraphs: [
        'To the maximum extent permitted by applicable law, Scholify shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenue, data, or use, arising from or related to your use of the service. Our total aggregate liability for any claim relating to the service shall not exceed the amounts paid by your school for the service in the twelve months preceding the claim, or USD 100, whichever is greater.',
      ],
    },
    {
      heading: '14. Indemnification',
      paragraphs: [
        'You agree to indemnify and hold Scholify harmless from claims arising out of your violation of these Terms or your misuse of the service.',
      ],
    },
    {
      heading: '15. Governing law',
      paragraphs: [
        'These Terms are governed by the laws of the Kurdistan Region of Iraq. Disputes shall be brought before the competent courts of Erbil.',
      ],
    },
    {
      heading: '16. Changes',
      paragraphs: [
        'We may update these Terms as the service evolves. Material changes will be communicated through the platform. Continued use of the service after a change indicates acceptance of the updated Terms.',
      ],
    },
    {
      heading: '17. Contact',
      paragraphs: [
        'Legal: legal@scholify.krd',
        'General contact: onboarding@scholify.krd',
      ],
    },
  ],
};

const termsAr: LegalDoc = {
  title: 'شروط الخدمة',
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: '١. الاتفاقية',
      paragraphs: [
        'تنظّم شروط الخدمة هذه ("الشروط") الوصول إلى Scholify ("الخدمة") واستخدامها. بإنشاء حساب أو تسجيل الدخول أو استخدام الخدمة بأي شكل آخر، فإنك توافق على هذه الشروط. إن لم توافق، فلا تستخدم الخدمة.',
      ],
    },
    {
      heading: '٢. الخدمة',
      paragraphs: [
        'Scholify منصة لإدارة المدارس تُقدَّم للمدارس عبر تطبيقات الويب وتطبيقات الهاتف والبوابة الأكاديمية. وتقرر المدرسة الميزات المُفعّلة لمستخدميها.',
      ],
    },
    {
      heading: '٣. الحسابات',
      list: [
        'تُنشأ الحسابات من قِبَل مدير المدرسة. لا تسمح Scholify بالتسجيل العام.',
        'أنت مسؤول عن سرية كلمة المرور وعن النشاط الذي يحدث تحت حسابك.',
        'إذا كنت تعتقد أن حسابك تم الوصول إليه دون إذنك، فاتصل بمدير المدرسة فوراً.',
      ],
    },
    {
      heading: '٤. مسؤوليات مدير المدرسة',
      paragraphs: [
        'تُعتبر المدرسة المسؤولة (المتحكمة) عن جميع البيانات المُدخلة على المنصة نيابةً عنها، وهي مسؤولة عن:',
      ],
      list: [
        'تحديد الموظفين والأدوار الممنوحة لكل منهم.',
        'ضمان دقة السجلات المُدخلة في المنصة.',
        'التواصل مع أولياء الأمور والموظفين بشأن طريقة استخدام المدرسة للمنصة.',
        'الوفاء بأي التزامات قطاعية تنطبق على المدرسة بموجب القانون المحلي.',
      ],
    },
    {
      heading: '٥. الاستخدام المقبول',
      paragraphs: [
        'أنت توافق على ألا:',
      ],
      list: [
        'تستخدم الخدمة لمضايقة أي شخص أو تهديده أو إيذائه.',
        'ترفع محتوى مخالفاً للقانون أو مسيئاً أو ينتهك حقوق الآخرين.',
        'تحاول الوصول إلى بيانات تخص مدرسة أخرى غير مدرستك.',
        'تفحص أو تختبر ثغرات الخدمة دون إذن خطي منا.',
        'تتدخل في تشغيل الخدمة أو في استخدام المستخدمين الآخرين لها.',
        'تستخدم الخدمة لإرسال رسائل جماعية غير مطلوبة.',
      ],
    },
    {
      heading: '٦. محتواك',
      paragraphs: [
        'تحتفظ بكل حقوقك على المحتوى الذي ترفعه (الرسائل، الملفات، المنشورات). وتمنحنا ترخيصاً محدوداً لاستضافته وتخزينه وعرضه فقط بالقدر اللازم لتشغيل الخدمة لمدرستك.',
      ],
    },
    {
      heading: '٧. الاشتراك والرسوم',
      paragraphs: [
        'تُتفق شروط الاشتراك والأسعار والدفع بشكل منفصل بين Scholify وكل مدرسة. ولا تُفرض رسوم على المستخدمين الأفراد (أولياء الأمور، المعلمون، الموظفون، السائقون) لاستخدام الخدمة.',
      ],
    },
    {
      heading: '٨. الخصوصية',
      paragraphs: [
        'يُوضَّح تعاملنا مع المعلومات الشخصية في سياسة الخصوصية. باستخدام الخدمة فإنك تُقرّ بهذه السياسة.',
      ],
    },
    {
      heading: '٩. توفّر الخدمة',
      paragraphs: [
        'نسعى للحفاظ على تشغيل الخدمة بشكل موثوق، لكننا لا نضمن توفّرها دون انقطاع. وقد نُجدول فترات صيانة أو نُعلّق الخدمة مؤقتاً لإجراء تغييرات أو معالجة قضايا أمنية.',
      ],
    },
    {
      heading: '١٠. تتبع الباصات — مهم',
      paragraphs: [
        'تقدّم ميزة تتبع الباصات تقديراً للموقع بناءً على بيانات GPS التي يشاركها السائقون. وتعتمد على الاتصال الخلوي ودقة GPS وجهاز السائق. ولا يجوز الاعتماد عليها في القرارات الحساسة للسلامة. التزم دائماً بإجراءات مدرستك الموحّدة لاستلام الطلاب والإشراف عليهم.',
      ],
    },
    {
      heading: '١١. الإنهاء',
      paragraphs: [
        'يجوز للمدرسة إنهاء استخدامها للخدمة في أي وقت. ويمكن لمدير المدرسة تعطيل الحسابات الفردية. وقد نُعلّق أو نُنهي الوصول في حال انتهاك هذه الشروط أو وجود خطر على المستخدمين الآخرين أو في حال تعذّر تقديم الخدمة.',
      ],
    },
    {
      heading: '١٢. إخلاء المسؤولية',
      paragraphs: [
        'تُقدَّم الخدمة "كما هي" و"حسب التوفّر" دون أي ضمانات صريحة أو ضمنية، بما في ذلك ضمانات القابلية للتسويق أو الملاءمة لغرض معين أو عدم الانتهاك، إلى أقصى حدّ يسمح به القانون المعمول به.',
      ],
    },
    {
      heading: '١٣. تحديد المسؤولية',
      paragraphs: [
        'إلى أقصى حدّ يسمح به القانون المعمول به، لا تتحمّل Scholify المسؤولية عن أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو عقابية، أو عن خسارة الأرباح أو الإيرادات أو البيانات أو الاستخدام، الناشئة عن استخدامك للخدمة. ولا تتجاوز المسؤولية الإجمالية لأي مطالبة المبلغ الذي دفعته مدرستك مقابل الخدمة في الأشهر الاثني عشر السابقة للمطالبة، أو ١٠٠ دولار أمريكي، أيهما أكبر.',
      ],
    },
    {
      heading: '١٤. التعويض',
      paragraphs: [
        'توافق على تعويض Scholify وحمايتها من أي مطالبات ناشئة عن انتهاكك لهذه الشروط أو سوء استخدامك للخدمة.',
      ],
    },
    {
      heading: '١٥. القانون الحاكم',
      paragraphs: [
        'تخضع هذه الشروط لقوانين إقليم كوردستان العراق. وتُرفع النزاعات أمام المحاكم المختصة في أربيل.',
      ],
    },
    {
      heading: '١٦. التغييرات',
      paragraphs: [
        'قد نُحدّث هذه الشروط مع تطور الخدمة. وسيتم إبلاغ التغييرات الجوهرية عبر المنصة. ويُعدّ استمرار استخدامك للخدمة بعد التغيير قبولاً للشروط المحدّثة.',
      ],
    },
    {
      heading: '١٧. التواصل',
      paragraphs: [
        'القانوني: legal@scholify.krd',
        'التواصل العام: onboarding@scholify.krd',
      ],
    },
  ],
};

const termsKu: LegalDoc = {
  title: 'مەرجەکانی خزمەتگوزاری',
  lastUpdated: LAST_UPDATED,
  sections: [
    {
      heading: '١. ڕێککەوتن',
      paragraphs: [
        'ئەم مەرجانەی خزمەتگوزاری ("مەرجەکان") گەیشتن و بەکارهێنانی Scholify ("خزمەتگوزاری") ڕێکدەخەن. بە دروستکردنی هەژمار، چوونەژوورەوە، یان بەکارهێنانی خزمەتگوزاری بە هەر شێوەیەک، تۆ ڕەزامەندی دەکەیت لەسەر ئەم مەرجانە. ئەگەر ڕەزامەند نیت، خزمەتگوزاری بەکار مەهێنە.',
      ],
    },
    {
      heading: '٢. خزمەتگوزاری',
      paragraphs: [
        'Scholify پلاتفۆڕمێکی بەڕێوەبردنی قوتابخانەیە کە بۆ قوتابخانەکان دابین دەکرێت. لەڕێی ئەپلیکەیشنی وێب، ئەپلیکەیشنی مۆبایل و دەرگای ئەکادیمی پێشکەش دەکرێت. قوتابخانە بڕیار دەدات کام تایبەتمەندیەکان بۆ بەکارهێنەرانی چالاک بکات.',
      ],
    },
    {
      heading: '٣. هەژمارەکان',
      list: [
        'هەژمارەکان لەلایەن بەڕێوەبەری قوتابخانەکەتەوە دروست دەکرێن. Scholify ڕێگە بە تۆمارکردنی گشتی نادات.',
        'تۆ بەرپرسیاریت لە پاراستنی نهێنی تێپەڕەوشەکەت و لە چالاکیەکانی ژێر هەژمارەکەت.',
        'ئەگەر پێت وایە هەژمارەکەت بەبێ مۆڵەتی تۆ گەیشتراوەتێ، تاوبەتاو پەیوەندی بە بەڕێوەبەری قوتابخانەوە بکە.',
      ],
    },
    {
      heading: '٤. بەرپرسیارێتی بەڕێوەبەری قوتابخانە',
      paragraphs: [
        'قوتابخانە کۆنترۆڵکارە بۆ هەموو ئەو داتایانەی کە لەسەر پلاتفۆڕم بە ناوی ئەوەوە تۆمار دەکرێت. قوتابخانە بەرپرسیارە لە:',
      ],
      list: [
        'هەڵبژاردنی کام کارمەند کام ڕۆڵی هەیە.',
        'دڵنیابوون لە دروستی تۆمارەکانی نێو پلاتفۆڕم.',
        'پەیوەندی لەگەڵ دایک و باوکان و کارمەنداندا دەربارەی چۆنیەتی بەکارهێنانی پلاتفۆڕم.',
        'پابەندبوون بە هەر ئەرکێکی کەرتی کە لەسەر قوتابخانە جێبەجێ دەبێت بەپێی یاسای ناوخۆیی.',
      ],
    },
    {
      heading: '٥. بەکارهێنانی پەسەند',
      paragraphs: [
        'تۆ ڕەزامەند دەبیت کە:',
      ],
      list: [
        'خزمەتگوزاری بەکار نەهێنیت بۆ بێزارکردن، هەڕەشەکردن، یان زیانگەیاندن بە هیچ کەسێک.',
        'ناوەڕۆکی نایاسایی، توندوتیژ یان پێشێلکاری مافی کەسانی تر بەرز نەکەیتەوە.',
        'هەوڵ نەدەیت بۆ گەیشتن بە داتای قوتابخانەیەکی تر جگە لە قوتابخانەکەت.',
        'بەبێ مۆڵەتی نووسراوی ئێمە، خزمەتگوزاری تاقی نەکەیتەوە یان فحصی نەکەیت.',
        'دەستێوەردان نەکەیت لە کارکردنی خزمەتگوزاری یان لە بەکارهێنانی بەکارهێنەرانی تر.',
        'خزمەتگوزاری بەکار نەهێنیت بۆ ناردنی نامەی بێ داوا.',
      ],
    },
    {
      heading: '٦. ناوەڕۆکی تۆ',
      paragraphs: [
        'تۆ هەموو مافەکانت دەهێڵیتەوە بۆ ئەو ناوەڕۆکەی کە دەینێریت (نامە، فایل، پۆست). تۆ مۆڵەتێکی سنووردارمان دەدەیتێ بۆ هۆستکردن، گەنجینەکردن و پیشاندانی ئەو ناوەڕۆکە تەنها بۆ کارکردنی خزمەتگوزاری بۆ قوتابخانەکەت.',
      ],
    },
    {
      heading: '٧. بەشداری و کرێ',
      paragraphs: [
        'مەرجەکانی بەشداری، نرخ و پارەدان بە جیا لە نێوان Scholify و هەر قوتابخانەیەکدا ڕێک دەخرێن. بەکارهێنەرانی تاکەکەسی (دایک و باوکان، مامۆستایان، کارمەندان، شۆفێرەکان) هیچ کرێیەکیان لەسەر نییە بۆ بەکارهێنانی خزمەتگوزاری.',
      ],
    },
    {
      heading: '٨. تایبەتمەندی',
      paragraphs: [
        'چۆنیەتی مامەڵەکردنمان لەگەڵ زانیاری کەسی لە سیاسەتی تایبەتمەندیدا ڕوون کراوەتەوە. بە بەکارهێنانی خزمەتگوزاری تۆ پەسەندی ئەو سیاسەتە دەکەیت.',
      ],
    },
    {
      heading: '٩. بەردەستبوونی خزمەتگوزاری',
      paragraphs: [
        'ئێمە کار دەکەین بۆ ئەوەی خزمەتگوزاری بە دڵنیاییەوە بەردەوام بێت، بەڵام پێشکەشکردنی بەبێ پچڕان دەستەبەر ناکەین. ڕەنگە چەند کاتژمێرێکی نوێکردنەوەمان هەبێت یان کاتیانە خزمەتگوزاری وەستین بۆ گۆڕانکاری یان چارەسەرکردنی کێشە ئاسایشەکان.',
      ],
    },
    {
      heading: '١٠. شوێنپێهەڵگرتنی پاس — گرنگ',
      paragraphs: [
        'تایبەتمەندی شوێنپێهەڵگرتنی پاس مەزەندەیەکی باشترینی شوێنی پاس دەخاتە بەردەستەوە بەپێی داتای GPS کە لەلایەن شۆفێرەکانەوە هاوبەش دەکرێت. بەستراوەتەوە بە پەیوەندی مۆبایل، دروستی GPS و ئامێری شۆفێر. نابێت پشتی پێ ببەسترێت بۆ بڕیارە حەساسەکانی سەلامەتی. هەمیشە ڕێوشوێنی ستانداردی قوتابخانەکەت پەیڕەو بکە بۆ وەرگرتن و چاودێریکردنی قوتابیان.',
      ],
    },
    {
      heading: '١١. کۆتاییهێنان',
      paragraphs: [
        'قوتابخانە دەتوانێت لە هەر کاتێکدا کۆتایی بە بەکارهێنانی خزمەتگوزاری بهێنێت. هەژمارە تاکەکەسەکان دەکرێت لەلایەن بەڕێوەبەری قوتابخانەوە چالاک نەکرێن. ئێمە دەتوانین گەیشتن بوەستێنین یان کۆتایی پێ بهێنین ئەگەر ئەم مەرجانە پێشێل بکرێن، یان مەترسی زیان لەسەر بەکارهێنەرانی تر هەبێت.',
      ],
    },
    {
      heading: '١٢. ئاگاداری',
      paragraphs: [
        'خزمەتگوزاری "وەکو هەیە" و "بەپێی بەردەستبوون" پێشکەش دەکرێت بەبێ هیچ ضمانێک، نه ڕاستەوخۆ نه ناڕاستەوخۆ، تا ئەو ڕادەی یاسا ڕێگەی پێ دەدات.',
      ],
    },
    {
      heading: '١٣. سنووری بەرپرسیارێتی',
      paragraphs: [
        'تا ئەو ڕادەی یاسا ڕێگەی پێ دەدات، Scholify بەرپرسیار نییە لە هیچ زیانێکی ناڕاستەوخۆ، ڕووداو، تایبەت، یاسایی یان سزایی، یان لە لەدەستچوونی قازانج، داهات، داتا، یان بەکارهێنان کە بەهۆی بەکارهێنانی خزمەتگوزاریتەوە دروست دەبێت. بەرپرسیارێتی گشتیمان بۆ هەر سکاڵایەک سەبارەت بە خزمەتگوزاری ناتوانێت زیاتر بێت لە ئەو بڕەی کە قوتابخانەکەت بۆ خزمەتگوزاری لە دوازدە مانگی پێش سکاڵاکەدا داویەتی، یان ١٠٠ دۆلاری ئەمریکی، هەرکامیان زیاترن.',
      ],
    },
    {
      heading: '١٤. قەرەبووکردنەوە',
      paragraphs: [
        'تۆ ڕەزامەند دەبیت Scholify لە هەر سکاڵایەک بپارێزیت کە لە پێشێلکردنی ئەم مەرجانە یان لە بەکارهێنانی نادروستی خزمەتگوزاریتەوە سەرچاوە دەگرێت.',
      ],
    },
    {
      heading: '١٥. یاسای حوکمدار',
      paragraphs: [
        'ئەم مەرجانە بە یاساکانی هەرێمی کوردستانی عێراق حوکم دەکرێن. ناکۆکیەکان دەخرێنە بەردەم دادگا پەیوەندیدارەکانی هەولێر.',
      ],
    },
    {
      heading: '١٦. گۆڕانکاریەکان',
      paragraphs: [
        'ڕەنگە ئەم مەرجانە نوێ بکەینەوە لەگەڵ گەشەکردنی خزمەتگوزاری. گۆڕانکاریە گرنگەکان لە ڕێگەی پلاتفۆڕمەوە ڕادەگەیەنرێن. بەردەوامبوون لە بەکارهێنانی خزمەتگوزاری دوای گۆڕانکاری بە پەسەندکردنی مەرجە نوێیەکان دادەنرێت.',
      ],
    },
    {
      heading: '١٧. پەیوەندی',
      paragraphs: [
        'یاسایی: legal@scholify.krd',
        'پەیوەندی گشتی: onboarding@scholify.krd',
      ],
    },
  ],
};

export const legal: Record<'privacy' | 'terms', Record<Lang, LegalDoc>> = {
  privacy: { en: privacyEn, ar: privacyAr, ku: privacyKu },
  terms:   { en: termsEn,   ar: termsAr,   ku: termsKu   },
};

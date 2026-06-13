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

const LAST_UPDATED = '2026-06-13';

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
        'This Privacy Policy explains how Scholify ("we", "us") handles information when a school uses our school-management platform. It covers our web apps, mobile apps, the academic portal, and the master portal. Scholify is operated by Rast Naser as an individual developer based in the Kurdistan Region of Iraq. Questions, data-subject requests, and legal notices can be directed to the addresses in the Contact section at the end of this policy.',
      ],
    },
    {
      heading: '2. Standards we follow',
      paragraphs: [
        'Iraq does not have a single comprehensive federal data-protection law. The Kurdistan Region operates under its own legal framework, which is evolving. We voluntarily align our practices with widely accepted international standards — most notably the principles of the EU General Data Protection Regulation (GDPR) — including data minimization, purpose limitation, integrity and confidentiality, and giving people meaningful control over information about them.',
        'Where a school operates under stricter local rules, the school remains responsible for its own sector-specific compliance. We support schools in meeting those obligations.',
      ],
    },
    {
      heading: '3. Who is the controller, and who is the processor',
      paragraphs: [
        'For most data on the platform — student records, attendance, grades, parent and employee details, school-managed messages — the school is the data controller, and Scholify acts as a processor on the school\'s instructions. This is the standard arrangement for school-management software.',
        'For a smaller set of data we collect directly from people who interact with us (demo requests, partner applications, contact forms, account-security records like your own password and multi-factor settings), Scholify is the controller.',
        'Where the school is the controller, requests to access, correct, export, or delete records should normally be made to the school first; we will help the school respond.',
      ],
    },
    {
      heading: '4. Who uses Scholify',
      paragraphs: [
        'Scholify is provided to schools. The people who use it are administrators, teachers, supervisors, accountants, reception staff, parents, and drivers. Students do not receive their own accounts. Information about students is entered by school staff and shown only to the appropriate roles within that school.',
      ],
    },
    {
      heading: '5. Information we collect',
      paragraphs: [
        'About your account:',
      ],
      list: [
        'Name, username, role, school, language preference.',
        'Password (stored hashed with bcrypt; never in plain text).',
        'Phone number — kept in international format. Used to deliver one-time verification codes for phone verification, password recovery, and two-step sign-in.',
        'Email address (optional) — used for password reset, security alerts, and as a fallback delivery channel for verification codes.',
        'Profile picture, if you upload one.',
        'Mobile push-notification token, on devices where you install the app.',
        'IP address, browser and device type, and basic logs needed to operate the service and keep it secure.',
      ],
    },
    {
      heading: '6. Verification codes and authentication artefacts',
      list: [
        'One-time verification codes: 6-digit codes generated when you verify a phone number, reset a password, or complete two-step sign-in. We store only a hashed copy; the plain code is sent to you and then discarded from our servers. Codes expire after 5 minutes. Repeated wrong attempts burn the code.',
        'Two-factor authenticator secrets: if you enable an authenticator-app code (TOTP), the secret is encrypted at rest with AES-256-GCM before storage. Recovery codes are also hashed at rest.',
        'Trusted-device tokens: if you tick "remember this browser", a random token is generated, the hash is stored, and the raw token is kept only on your device.',
        'Sessions: we use short-lived JWT access tokens with rotating refresh tokens. You can list and revoke sessions in account settings.',
      ],
    },
    {
      heading: '7. Information about students',
      paragraphs: [
        'Schools enter information about students directly into the platform. We handle this information on the school\'s behalf. It typically includes:',
      ],
      list: [
        'Name, date of birth, class assignment, guardian links.',
        'Profile picture and emergency contact (if the school records them).',
        'Attendance, grades, reports, behavior tags, narrative observations.',
        'Homework and assignment status, including dates and any teacher feedback.',
        'Home pickup coordinates, if a parent saves them for the bus-tracking feature.',
        'Chat messages between school users that mention or are about the student.',
      ],
    },
    {
      heading: '8. Information about employees',
      paragraphs: [
        'For staff members, schools can record HR information through the employee profile features. Some fields are stored as plain text inside the school\'s tenant; others are encrypted at rest because of their sensitivity:',
      ],
      list: [
        'Plain-text fields (visible to HR within the school): phone, email, address, hire date, national ID, date of birth, marital status, gender, employment type, qualifications, notes, official photo.',
        'Encrypted-at-rest fields (visible to HR within the school, ciphertext at rest): mother / father / spouse names, bank IBAN, tax ID, social insurance number, religion. These use AES-256-GCM with school-specific keys derived via HKDF.',
        'HR action log: warnings, performance reviews, terminations, and similar lifecycle events recorded by the school.',
        'Identity-document scans uploaded by HR are stored as files associated with the employee record.',
      ],
      // Special-category data note continues into the next section.
    },
    {
      heading: '9. Special-category and sensitive personal data',
      paragraphs: [
        'Some of the data described above is considered "special category" under the GDPR or otherwise particularly sensitive — most notably religion, national identifiers, bank details, and any health-adjacent information that may appear in emergency-contact notes or attendance reasons.',
        'We process this data only on the instructions of the school, only for HR and administration purposes, and we apply encryption-at-rest for the highest-sensitivity fields (religion, social insurance number, bank IBAN, tax ID). Access is restricted to HR-officer roles within the school.',
      ],
    },
    {
      heading: '10. How we use information and our lawful basis',
      paragraphs: [
        'We use information to operate the service the school has asked for: to authenticate users, deliver messages and alerts, calculate grades and reports, show bus location to the right parents at the right time, keep the platform secure, and run our business.',
        'Where the GDPR framework applies, the lawful bases we rely on are:',
      ],
      list: [
        'Performance of a contract — to deliver the service the school has subscribed to on your behalf, including authentication, messaging, and core school workflows (GDPR Art. 6(1)(b)).',
        'Legitimate interests — to keep the platform secure, prevent and investigate abuse, and operate our business (Art. 6(1)(f)).',
        'Legal obligation — to retain certain records the school or we are legally required to keep (Art. 6(1)(c)).',
        'Consent — for optional features such as push notifications, marketing communications about Scholify, and any non-essential cookies (Art. 6(1)(a)).',
        'For special-category data — explicit consent or employment / social-protection obligations (Art. 9(2)(a) or 9(2)(b)).',
      ],
      // Continued below
    },
    {
      heading: '11. What we never do',
      list: [
        'We do not sell personal information.',
        'We do not show advertising and we do not share information with advertisers or data brokers.',
        'We do not use personal information to train AI models.',
        'We do not mix one school\'s data with another\'s. Every record is scoped to the school it belongs to and enforced by per-request school-scoping plus database row-level security.',
      ],
    },
    {
      heading: '12. Children\'s data',
      paragraphs: [
        'Scholify handles information about children because schools handle information about children. The school is the controller; Scholify acts as the processor. The information we handle about students includes name, date of birth, photograph, class, attendance, grades, narrative reports and behavior tags, emergency-contact notes, homework status, and — if a parent enables the bus-tracking feature — the family\'s home pickup coordinates.',
        'Students do not have their own Scholify accounts. We do not contact students directly. Notifications, verification codes, and account communications go to the parent or guardian on the parent account. We do not sell or share children\'s data with marketers and we never use it to train AI models.',
        'Parental rights — including the right to access, correct, or request deletion of information held about a child — should normally be exercised through the school as the controller. We support the school in fulfilling those requests.',
      ],
    },
    {
      heading: '13. Phone verification and two-step sign-in',
      paragraphs: [
        'We deliver one-time verification codes by WhatsApp through OTPIQ, our Iraq-based verification gateway (https://otpiq.com). OTPIQ then relays the message through Meta Platforms Ireland Limited (WhatsApp) on the last mile. If WhatsApp delivery fails or you have not enabled WhatsApp, we fall back to email through Resend, provided you have an email on file.',
        'When we send a code, we transmit your phone number (in international format) and the code itself to OTPIQ. OTPIQ also reports the delivery status back to us through a signed webhook so we know whether to retry or trigger the email fallback. The code is also stored on our servers in hashed form, with a five-minute expiry, until you enter it or it expires.',
        'Standard carrier or messaging charges may apply on the WhatsApp side; that is between you and your mobile operator. WhatsApp delivery itself is not guaranteed — if you do not receive a code, request a new one or use the email fallback if your account has an email address on file.',
      ],
    },
    {
      heading: '14. Sub-processors',
      paragraphs: [
        'We rely on a small number of trusted infrastructure providers to run the service. They process data only on our instructions:',
      ],
      list: [
        'Supabase (United States / European Union) — Postgres database, file storage, and authentication primitives.',
        'Railway (United States) — backend API hosting.',
        'Vercel (United States / European Union) — web hosting for the landing site, school portal, and academic portal.',
        'Cloudflare (global) — DNS, CDN, and inbound email routing for our scholify.krd addresses (support@, onboarding@, contact@, partner@). Inbound messages are parsed by a Cloudflare Worker before being forwarded to our backend.',
        'GitHub Actions (United States) — continuous integration and deployment pipeline.',
        'Expo (United States) — mobile app delivery (over-the-air updates) and push-notification routing.',
        'Apple Push Notification service (United States, downstream of Expo) — iOS push delivery.',
        'Firebase Cloud Messaging by Google (United States / European Union, downstream of Expo) — Android push delivery.',
        'OTPIQ (Iraq) — WhatsApp verification gateway used for phone verification, password recovery, and two-step sign-in.',
        'Meta Platforms Ireland Limited / WhatsApp (Ireland, downstream of OTPIQ) — last-mile delivery of verification messages.',
        'Resend (United States) — outbound email: demo requests, partner applications, password-reset notifications, security alerts, the email fallback for verification codes, and operator replies to support correspondence.',
        'Google Maps (United States / European Union) — map tiles and address lookups for bus tracking and pickup-point setup.',
        'Backblaze B2 (United States) — encrypted nightly backups. The data is encrypted on our side with age + AES before it leaves our infrastructure; Backblaze stores ciphertext only.',
      ],
    },
    {
      heading: '15. Where data is stored',
      paragraphs: [
        'Primary processing happens on cloud infrastructure operated by the sub-processors above, primarily in data centers located in the United States and the European Union. One exception applies: when we deliver a WhatsApp verification code, your phone number and the code itself are processed in Iraq by OTPIQ before being relayed to WhatsApp.',
        'Encrypted backups are stored at Backblaze B2 as ciphertext only. Connections to all providers are encrypted in transit (HTTPS/TLS).',
      ],
    },
    {
      heading: '16. Security',
      paragraphs: [
        'We apply layered safeguards to protect personal data. No service is unbreakable, but we make and keep the following technical commitments:',
      ],
      list: [
        'HTTPS/TLS for every connection between apps, the backend, and sub-processors.',
        'Passwords hashed with bcrypt; never stored in plain text. New accounts created with a default password are required to choose a new one on first sign-in.',
        'Two-factor authentication available across staff roles: an authenticator-app code (TOTP) with single-use recovery codes. Phone-based two-step sign-in is being rolled out for parent and driver accounts.',
        'Two-factor secrets and selected employee fields (religion, social insurance number, bank IBAN, tax ID) encrypted at rest with AES-256-GCM, using per-school keys derived via HKDF.',
        'Verification codes, recovery codes, and trusted-device tokens hashed at rest (sha256) so we can verify them but cannot read them.',
        'Tamper-evident, hash-chained audit log of sensitive actions (creates, updates, deletes, archives).',
        'Short-lived JWT access tokens with rotating refresh tokens, per-session families, user-initiated session revocation, and automatic session invalidation on security-relevant changes.',
        'Per-request school-scoping enforced both in the application layer and by Postgres row-level security so one school cannot read another school\'s data.',
        'Per-user and per-IP rate limiting on authentication endpoints; tighter limits on verification-code sends.',
      ],
    },
    {
      heading: '17. Mobile app permissions',
      paragraphs: [
        'When you install the Scholify mobile app, it may ask for the following device permissions. You can grant, deny, or revoke any of them at any time through your operating system\'s settings; doing so may disable the related feature.',
      ],
      list: [
        'Push notifications — to deliver homework, attendance, announcement, and chat alerts.',
        'Location, parents — only when you tap "Set pickup point". We use the one-time reading to save your pickup coordinates. We do not track parents in the background. Parents can also see the bus position on a live map while a trip is active; that does not require sharing the parent\'s location.',
        'Location, drivers — while a drive is active, the app shares GPS so the live bus map updates for parents. On Android, the operating system may request background-location permission so the live map keeps updating when the app is not in the foreground during a trip. Location sharing stops when the driver ends the trip.',
        'Photo library and camera — only when you choose to upload a profile picture or attach a photo. We do not access your photos otherwise.',
      ],
    },
    {
      heading: '18. Storage on your device',
      paragraphs: [
        'Scholify does not use third-party tracking or advertising cookies. The web apps and mobile app use minimal storage to operate:',
      ],
      list: [
        'Web — browser localStorage or sessionStorage holds your JWT access token, refresh token, and language preference. A trusted-device hash may also be stored if you tick "remember this browser".',
        'Mobile — AsyncStorage holds the same authentication tokens, your language preference, your consent acceptance flag, and the push-notification token issued by Expo/Apple/Google.',
      ],
    },
    {
      heading: '19. Data retention',
      list: [
        'Active accounts — data is kept while the account is active and the school has not asked us to delete it.',
        'Archived students and employees — when a student leaves or an employee departs, the school may archive the record. Archived records are kept as a historical record for the school until the school chooses to purge them, subject to any legal retention obligations.',
        'Deleted live records — removed from the live database within 30 days of deletion, except where law or audit requires retention.',
        'Encrypted backups — retained at Backblaze B2 for up to 90 days on a rolling window. Deletions from the live system are reflected in backups as each backup ages out of the window.',
        'Verification codes (phone OTP) — hashed at rest; entries are no longer usable after a five-minute expiry. Webhook delivery events are retained for operational debugging and security review.',
        'Hash-chained audit log — append-only and not deleted. See the next section for how this affects the right to erasure.',
        'Chat messages — retained for the school\'s record. When a message is edited or deleted from the visible thread, the underlying record is preserved for a limited moderation-review window before final purge.',
        'Bus GPS — live position is shown in real time during a trip. We retain a short trip-scoped history for trip review and dispute resolution; we do not keep long-term location histories of individuals.',
      ],
    },
    {
      heading: '20. Your rights',
      paragraphs: [
        'You have the right to:',
      ],
      list: [
        'Access — receive a copy of the personal information we hold about you.',
        'Correct — fix inaccurate information.',
        'Delete — request deletion of your information (with the limits described in the next section).',
        'Portability — receive your data in a portable format.',
        'Object — to a specific use of your information.',
        'Withdraw consent — at any time, for any use that depends on your consent.',
        'Lodge a complaint with a supervisory authority where one is competent over the processing.',
      ],
      // continued
    },
    {
      heading: '21. How to exercise your rights',
      paragraphs: [
        'For data the school controls (student records, parent records, school communications, employee HR records), please contact your school administrator first. The school will respond directly and may route the request to us if our help is needed.',
        'For data we control (your own password, your own multi-factor settings, your own contact information you have given us, marketing-contact records), email privacy@scholify.krd.',
        'We aim to acknowledge requests within 14 days and respond substantively within 30 days. We may ask for proof of identity before fulfilling sensitive requests. There is no fee for reasonable requests.',
      ],
    },
    {
      heading: '22. Limits on the right to erasure',
      paragraphs: [
        'We honour erasure requests as far as we can, but the platform\'s architecture and the school\'s obligations impose three limits:',
      ],
      list: [
        'Hash-chained audit log — entries are not deleted, because doing so would break the tamper-evidence guarantee that protects every school against unauthorised changes. When you ask us to erase you, we replace identifying fields with non-identifying tombstones rather than removing entries.',
        'Encrypted backups — Backblaze B2 backups follow a rolling 90-day retention window. Deletions from the live system are reflected in backups when each backup ages out of the window.',
        'Legal and audit retention — some records (financial transactions, employee acknowledgements, payroll, regulatory submissions) carry separate retention obligations that the school is required to meet. We will explain which obligation applies when we respond to your request.',
      ],
    },
    {
      heading: '23. Data breaches',
      paragraphs: [
        'If we become aware of a personal-data breach that is likely to affect you, we will notify the affected school\'s administrator without undue delay and in any event within 72 hours of becoming aware of the breach, in line with the timelines expected under GDPR Art. 33. The notification will provide enough detail for the school to assess the impact and to inform affected users or regulators where required.',
      ],
    },
    {
      heading: '24. Changes to sub-processors',
      paragraphs: [
        'When we add, remove, or materially change a sub-processor, we update the list in section 14 and surface a notice in the platform. The Last updated date at the top of this policy reflects the most recent change. We recommend reviewing the list periodically.',
      ],
    },
    {
      heading: '25. Schools\' separate responsibilities',
      paragraphs: [
        'Each school decides which staff have which role, what information is entered into the platform, and how its own retention and communications obligations are met. Sector-specific obligations (education-records rules, child-safeguarding registers, payroll, taxation) remain the school\'s responsibility.',
      ],
    },
    {
      heading: '26. Changes to this policy',
      paragraphs: [
        'We may update this policy as the service evolves. Material changes will be communicated through the platform. Continued use of the service after a material change indicates acknowledgement of the updated policy.',
      ],
    },
    {
      heading: '27. Contact',
      paragraphs: [
        'Privacy and data-subject requests: privacy@scholify.krd',
        'Legal: legal@scholify.krd',
        'General contact: onboarding@scholify.krd',
        'Postal address: Rast Naser, Erbil, Kurdistan Region of Iraq.',
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
        'توضح سياسة الخصوصية هذه كيف تتعامل Scholify ("نحن") مع المعلومات عند استخدام مدرسة لمنصتنا لإدارة المدارس. وتشمل تطبيقات الويب وتطبيقات الهاتف والبوابة الأكاديمية والبوابة الرئيسية. تُشغَّل Scholify من قِبَل راست ناصر بصفته مطوّراً فردياً مقيماً في إقليم كردستان العراق. يمكن توجيه الاستفسارات وطلبات أصحاب البيانات والإشعارات القانونية إلى العناوين الواردة في قسم التواصل في نهاية هذه السياسة.',
      ],
    },
    {
      heading: '٢. المعايير التي نتبعها',
      paragraphs: [
        'لا يوجد حالياً في العراق قانون اتحادي شامل واحد لحماية البيانات. ولإقليم كردستان إطاره القانوني الخاص الذي يشهد تطوراً. ونلتزم طوعياً بمواءمة ممارساتنا مع المعايير الدولية المعتمدة على نطاق واسع — وأبرزها مبادئ اللائحة العامة لحماية البيانات في الاتحاد الأوروبي (GDPR) — بما في ذلك تقليل البيانات وتحديد الغرض والنزاهة والسرية ومنح الأشخاص تحكماً فعلياً في المعلومات الخاصة بهم.',
        'وعندما تعمل المدرسة بموجب قواعد محلية أكثر صرامة، تظل المدرسة مسؤولة عن امتثالها القطاعي. ونحن ندعم المدارس في الوفاء بهذه الالتزامات.',
      ],
    },
    {
      heading: '٣. من هو المتحكم ومن هو المعالج',
      paragraphs: [
        'بالنسبة لمعظم البيانات على المنصة — سجلات الطلاب والحضور والدرجات وتفاصيل أولياء الأمور والموظفين والرسائل المُدارة من المدرسة — تكون المدرسة هي المتحكم في البيانات، وتعمل Scholify بصفة معالج بناءً على تعليمات المدرسة. هذا هو الترتيب المعتاد لبرمجيات إدارة المدارس.',
        'وبالنسبة لمجموعة أصغر من البيانات التي نجمعها مباشرة من الأشخاص الذين يتفاعلون معنا (طلبات العرض التجريبي وطلبات الشراكة ونماذج الاتصال وسجلات أمان الحساب مثل كلمة المرور الخاصة بك وإعدادات المصادقة متعددة العوامل)، تكون Scholify هي المتحكم.',
        'وعندما تكون المدرسة هي المتحكم، يجب توجيه طلبات الاطلاع والتصحيح والتصدير والحذف إلى المدرسة أولاً؛ وسنساعد المدرسة في الاستجابة.',
      ],
    },
    {
      heading: '٤. من يستخدم Scholify',
      paragraphs: [
        'تُقدَّم Scholify للمدارس. ومستخدموها هم المدراء والمعلمون والمشرفون والمحاسبون وموظفو الاستقبال وأولياء الأمور والسائقون. لا يحصل الطلاب على حسابات خاصة بهم. وتُدخل معلومات الطلاب من قِبَل موظفي المدرسة وتُعرض فقط على الأدوار المختصة داخل تلك المدرسة.',
      ],
    },
    {
      heading: '٥. المعلومات التي نجمعها',
      paragraphs: [
        'حول حسابك:',
      ],
      list: [
        'الاسم، اسم المستخدم، الدور، المدرسة، اللغة المفضلة.',
        'كلمة المرور (تُخزَّن مُجزَّأة بـ bcrypt؛ ولا تُحفظ كنص ظاهر أبداً).',
        'رقم الهاتف — يُحفظ بالصيغة الدولية. ويُستخدم لإيصال رموز التحقق لمرة واحدة للتحقق من الهاتف وإعادة تعيين كلمة المرور والمصادقة بخطوتين.',
        'عنوان البريد الإلكتروني (اختياري) — يُستخدم لإعادة تعيين كلمة المرور وتنبيهات الأمان وكقناة بديلة لإيصال رموز التحقق.',
        'صورة الملف الشخصي إن قمت برفعها.',
        'رمز الإشعارات على الأجهزة التي تُثبَّت عليها التطبيق.',
        'عنوان IP، نوع المتصفح/الجهاز، وسجلات أساسية لازمة لتشغيل الخدمة وتأمينها.',
      ],
    },
    {
      heading: '٦. رموز التحقق وعناصر المصادقة',
      list: [
        'رموز التحقق لمرة واحدة: رموز من ٦ أرقام تُولَّد عند التحقق من رقم هاتف أو إعادة تعيين كلمة المرور أو إكمال المصادقة بخطوتين. نخزّن نسخة مُجزَّأة فقط؛ ويُرسَل الرمز الأصلي إليك ثم يُتلف من خوادمنا. تنتهي صلاحية الرموز بعد ٥ دقائق. وتكرار المحاولات الخاطئة يُلغي الرمز.',
        'أسرار المصادقة الثنائية: عند تفعيل رمز تطبيق المصادقة (TOTP)، يُشفَّر السرّ أثناء التخزين بـ AES-256-GCM. وتُجزَّأ رموز الاسترداد أيضاً أثناء التخزين.',
        'رموز الأجهزة الموثوقة: عند تأشير "تذكّر هذا المتصفح"، يُولَّد رمز عشوائي وتُخزَّن قيمته المُجزَّأة، ويُحفظ الرمز الأصلي على جهازك فقط.',
        'الجلسات: نستخدم رموز وصول JWT قصيرة العمر مع رموز تحديث دوّارة. ويمكنك عرض الجلسات وإبطالها من إعدادات الحساب.',
      ],
    },
    {
      heading: '٧. المعلومات المتعلقة بالطلاب',
      paragraphs: [
        'تُدخل المدارس معلومات الطلاب مباشرة في المنصة. ونتعامل مع هذه المعلومات نيابةً عن المدرسة. وتشمل عادةً:',
      ],
      list: [
        'الاسم، تاريخ الميلاد، الصف المُسنَد، روابط ولي الأمر.',
        'صورة الملف الشخصي وجهة الاتصال في حالات الطوارئ (إن سجّلتها المدرسة).',
        'الحضور، الدرجات، التقارير، علامات السلوك، الملاحظات السردية.',
        'حالة الواجبات والتكاليف، بما في ذلك التواريخ وأي ملاحظات من المعلم.',
        'إحداثيات نقطة الاستلام في المنزل، إن قام ولي الأمر بحفظها لميزة تتبع الباص.',
        'رسائل المحادثات بين مستخدمي المدرسة التي تذكر الطالب أو تتعلق به.',
      ],
    },
    {
      heading: '٨. المعلومات المتعلقة بالموظفين',
      paragraphs: [
        'بالنسبة لأعضاء الكادر، يمكن للمدارس تسجيل معلومات الموارد البشرية عبر ميزات ملف الموظف. وبعض الحقول تُخزَّن كنص ظاهر داخل بيئة المدرسة، فيما تُشفَّر حقول أخرى أثناء التخزين بسبب حساسيتها:',
      ],
      list: [
        'حقول النص الظاهر (تظهر للموارد البشرية داخل المدرسة): الهاتف، البريد الإلكتروني، العنوان، تاريخ التعيين، الرقم الوطني، تاريخ الميلاد، الحالة الاجتماعية، الجنس، نوع التوظيف، المؤهلات، الملاحظات، الصورة الرسمية.',
        'حقول مشفّرة أثناء التخزين (تظهر للموارد البشرية داخل المدرسة، وتكون مشفّرة في طبقة التخزين): أسماء الأم/الأب/الزوج، رقم IBAN المصرفي، الرقم الضريبي، رقم التأمين الاجتماعي، الديانة. وتستخدم AES-256-GCM بمفاتيح خاصة بكل مدرسة مشتقّة عبر HKDF.',
        'سجل إجراءات الموارد البشرية: التحذيرات، تقييمات الأداء، إنهاء الخدمة، وما يشابهها من أحداث دورة حياة الموظف.',
        'تُحفظ مسوحات وثائق الهوية التي تُرفع من قِبَل الموارد البشرية كملفات مرتبطة بسجل الموظف.',
      ],
    },
    {
      heading: '٩. البيانات الحساسة والفئات الخاصة',
      paragraphs: [
        'تُعتبر بعض البيانات الموصوفة أعلاه "فئة خاصة" بموجب اللائحة العامة لحماية البيانات أو حساسة بشكل خاص — وأبرزها الديانة، والمعرّفات الوطنية، والتفاصيل المصرفية، وأي معلومات صحية محتملة قد تظهر في ملاحظات الاتصال للطوارئ أو أسباب الغياب.',
        'نعالج هذه البيانات فقط بناءً على تعليمات المدرسة، ولأغراض الموارد البشرية والإدارة فقط، ونطبّق التشفير أثناء التخزين على الحقول الأعلى حساسية (الديانة، رقم التأمين الاجتماعي، IBAN المصرفي، الرقم الضريبي). والوصول مقتصر على أدوار مسؤول الموارد البشرية داخل المدرسة.',
      ],
    },
    {
      heading: '١٠. كيف نستخدم المعلومات والأساس القانوني',
      paragraphs: [
        'نستخدم المعلومات لتشغيل الخدمة التي طلبتها المدرسة: للمصادقة على المستخدمين، وإيصال الرسائل والتنبيهات، وحساب الدرجات والتقارير، وإظهار موقع الباص لولي الأمر المعنيّ في الوقت المناسب، والحفاظ على أمان المنصة وتشغيل أعمالنا.',
        'وعند انطباق إطار اللائحة العامة لحماية البيانات (GDPR)، فإن الأسس القانونية التي نعتمد عليها هي:',
      ],
      list: [
        'تنفيذ عقد — لتقديم الخدمة التي اشتركت فيها المدرسة نيابةً عنك، بما في ذلك المصادقة والمراسلة وسير العمل الأساسي للمدرسة (المادة ٦(١)(ب)).',
        'المصالح المشروعة — للحفاظ على أمان المنصة ومنع إساءة الاستخدام والتحقيق فيها وإدارة أعمالنا (المادة ٦(١)(و)).',
        'الالتزام القانوني — للاحتفاظ بسجلات معيّنة يُلزمنا بها القانون أو تلتزم بها المدرسة (المادة ٦(١)(ج)).',
        'الموافقة — للميزات الاختيارية مثل الإشعارات والتواصل التسويقي بشأن Scholify وأي ملفات تعريف ارتباط غير ضرورية (المادة ٦(١)(أ)).',
        'البيانات من الفئات الخاصة — الموافقة الصريحة أو التزامات التوظيف/الحماية الاجتماعية (المادتان ٩(٢)(أ) أو ٩(٢)(ب)).',
      ],
    },
    {
      heading: '١١. ما لا نفعله أبداً',
      list: [
        'لا نبيع المعلومات الشخصية.',
        'لا نعرض إعلانات ولا نشارك المعلومات مع المعلنين أو وسطاء البيانات.',
        'لا نستخدم المعلومات الشخصية لتدريب نماذج الذكاء الاصطناعي.',
        'لا نمزج بيانات مدرسة مع بيانات مدرسة أخرى. كل سجل مرتبط بالمدرسة التي يخصّها ويُفرض ذلك عبر فحوصات نطاق المدرسة في كل طلب وكذلك أمان مستوى الصف في قاعدة البيانات.',
      ],
    },
    {
      heading: '١٢. بيانات الأطفال',
      paragraphs: [
        'تتعامل Scholify مع معلومات الأطفال لأن المدارس تتعامل مع معلومات الأطفال. المدرسة هي المتحكم وScholify هي المعالج. وتشمل المعلومات التي نتعامل معها عن الطلاب: الاسم، وتاريخ الميلاد، والصورة، والصف، والحضور، والدرجات، والتقارير السردية وعلامات السلوك، وملاحظات الاتصال للطوارئ، وحالة الواجبات، وإذا فعّل ولي الأمر ميزة تتبع الباص فإحداثيات نقطة الاستلام للأسرة.',
        'لا يملك الطلاب حسابات خاصة بهم في Scholify. ولا نتواصل مع الطلاب مباشرة. وتُرسل الإشعارات ورموز التحقق والاتصالات المتعلقة بالحساب إلى ولي الأمر أو الوصي على حساب ولي الأمر. ولا نبيع بيانات الأطفال أو نشاركها مع المعلنين ولا نستخدمها لتدريب نماذج الذكاء الاصطناعي.',
        'يجب ممارسة حقوق الوالدين — بما في ذلك حق الاطلاع على المعلومات التي نحتفظ بها عن الطفل وتصحيحها أو طلب حذفها — عادةً عبر المدرسة بوصفها المتحكم. وندعم المدرسة في تنفيذ هذه الطلبات.',
      ],
    },
    {
      heading: '١٣. التحقق عبر الهاتف والمصادقة بخطوتين',
      paragraphs: [
        'نُسلِّم رموز التحقق لمرة واحدة عبر WhatsApp من خلال OTPIQ، بوابة التحقق التي يقع مقرها في العراق (https://otpiq.com). ثم تُمرِّر OTPIQ الرسالة عبر Meta Platforms Ireland Limited (WhatsApp) في الجزء الأخير. وإن فشل تسليم WhatsApp أو لم تكن مفعّلاً WhatsApp، فإننا نلجأ إلى البريد الإلكتروني عبر Resend، شرط أن يكون لديك بريد إلكتروني مسجَّل.',
        'عند إرسال رمز، نُحوِّل رقم هاتفك (بالصيغة الدولية) والرمز نفسه إلى OTPIQ. كما تُبلِغ OTPIQ بحالة التسليم إلينا عبر webhook موقَّعة لمعرفة ما إذا كان يلزم إعادة المحاولة أو تفعيل البديل عبر البريد الإلكتروني. ويُخزَّن الرمز كذلك على خوادمنا بصورة مُجزَّأة بانتهاء صلاحية ٥ دقائق إلى أن تُدخله أو تنتهي صلاحيته.',
        'قد تنطبق رسوم الناقل أو الرسائل المعتادة من جهة WhatsApp؛ وهذا أمر بينك وبين مزوّد خدمتك. وتسليم WhatsApp ذاته ليس مضموناً — إذا لم تستلم رمزاً، فاطلب رمزاً جديداً أو استخدم البديل عبر البريد الإلكتروني إذا كان حسابك يحتوي على عنوان بريد إلكتروني.',
      ],
    },
    {
      heading: '١٤. المعالجون الفرعيون',
      paragraphs: [
        'نعتمد على عدد محدود من مزوّدي البنية التحتية الموثوقين لتشغيل الخدمة. وهم يعالجون البيانات بناءً على تعليماتنا فقط:',
      ],
      list: [
        'Supabase (الولايات المتحدة / الاتحاد الأوروبي) — قاعدة بيانات Postgres وتخزين الملفات وأساسيات المصادقة.',
        'Railway (الولايات المتحدة) — استضافة الواجهة الخلفية.',
        'Vercel (الولايات المتحدة / الاتحاد الأوروبي) — استضافة الموقع العام وبوابة المدرسة والبوابة الأكاديمية.',
        'Cloudflare (عالمي) — DNS وCDN وتوجيه البريد الإلكتروني الوارد لعناوين scholify.krd (support@، onboarding@، contact@، partner@). يُحلَّل البريد الوارد بواسطة Cloudflare Worker قبل توجيهه إلى الواجهة الخلفية لدينا.',
        'GitHub Actions (الولايات المتحدة) — التكامل المستمر والنشر.',
        'Expo (الولايات المتحدة) — توصيل تطبيق الهاتف (تحديثات OTA) وتوجيه الإشعارات.',
        'خدمة إشعارات Apple (الولايات المتحدة، تابعة لـ Expo) — تسليم الإشعارات على iOS.',
        'Firebase Cloud Messaging من Google (الولايات المتحدة / الاتحاد الأوروبي، تابعة لـ Expo) — تسليم الإشعارات على Android.',
        'OTPIQ (العراق) — بوابة تحقق WhatsApp للتحقق من الهاتف وإعادة تعيين كلمة المرور والمصادقة بخطوتين.',
        'Meta Platforms Ireland Limited / WhatsApp (أيرلندا، تابعة لـ OTPIQ) — تسليم رسائل التحقق في المرحلة الأخيرة.',
        'Resend (الولايات المتحدة) — البريد الصادر: طلبات العرض التجريبي، طلبات الشراكة، إشعارات إعادة تعيين كلمة المرور، تنبيهات الأمان، البديل عبر البريد الإلكتروني لرموز التحقق، وردود المشغل على بريد الدعم.',
        'Google Maps (الولايات المتحدة / الاتحاد الأوروبي) — خرائط وعمليات بحث عن العناوين لتتبع الباص وإعداد نقطة الاستلام.',
        'Backblaze B2 (الولايات المتحدة) — نسخ احتياطية ليلية مُشفّرة. تُشفَّر البيانات من جانبنا بـ age + AES قبل مغادرة بنيتنا التحتية؛ ولا تخزّن Backblaze سوى النص المشفّر.',
      ],
    },
    {
      heading: '١٥. مكان تخزين البيانات',
      paragraphs: [
        'تتم المعالجة الأساسية على البنية التحتية السحابية التي يديرها المعالجون الفرعيون أعلاه، وفي الغالب في مراكز بيانات بالولايات المتحدة والاتحاد الأوروبي. ويُستثنى من ذلك حالة واحدة: عند تسليم رمز تحقق WhatsApp، يُعالَج رقم هاتفك والرمز نفسه في العراق بواسطة OTPIQ قبل تمريرهما إلى WhatsApp.',
        'تُخزَّن النسخ الاحتياطية المشفّرة في Backblaze B2 كنص مشفّر فقط. وجميع الاتصالات مع المزوّدين مشفّرة أثناء النقل (HTTPS/TLS).',
      ],
    },
    {
      heading: '١٦. الأمان',
      paragraphs: [
        'نطبّق ضمانات متعدّدة الطبقات لحماية البيانات الشخصية. لا توجد خدمة لا يمكن اختراقها، لكننا نقدّم ونلتزم بالتعهّدات التقنية التالية:',
      ],
      list: [
        'HTTPS/TLS لكل اتصال بين التطبيقات والواجهة الخلفية والمعالجين الفرعيين.',
        'تجزئة كلمات المرور بـ bcrypt؛ ولا تُخزَّن أبداً كنص ظاهر. والحسابات الجديدة المُنشأة بكلمة مرور افتراضية مُلزَمة باختيار كلمة مرور جديدة عند أول تسجيل دخول.',
        'المصادقة الثنائية متاحة لأدوار الكادر: رمز تطبيق المصادقة (TOTP) مع رموز استرداد لمرة واحدة. ويُطرح تباعاً تسجيل الدخول بخطوتين عبر الهاتف لحسابات أولياء الأمور والسائقين.',
        'أسرار المصادقة الثنائية وحقول الموظف المختارة (الديانة، رقم التأمين الاجتماعي، IBAN، الرقم الضريبي) مشفّرة أثناء التخزين بـ AES-256-GCM، بمفاتيح خاصة بكل مدرسة مشتقّة عبر HKDF.',
        'رموز التحقق ورموز الاسترداد ورموز الأجهزة الموثوقة مُجزَّأة أثناء التخزين (sha256) فيمكننا التحقق منها لكن لا يمكننا قراءتها.',
        'سجل تدقيق مقاوم للعبث، مرتبط بسلسلة هاش، للإجراءات الحساسة (الإنشاء، التحديث، الحذف، الأرشفة).',
        'رموز وصول JWT قصيرة العمر مع رموز تحديث دوّارة، وعائلات لكل جلسة، وإلغاء جلسة بمبادرة من المستخدم، وإبطال تلقائي للجلسات عند التغييرات الحساسة من ناحية الأمان.',
        'فحوصات نطاق المدرسة في كل طلب على مستوى التطبيق وكذلك أمان مستوى الصف في Postgres بحيث لا تتمكّن مدرسة من قراءة بيانات مدرسة أخرى.',
        'تحديد المعدّل لكل مستخدم ولكل عنوان IP على نقاط نهاية المصادقة؛ وحدود أشدّ على إرسال رموز التحقق.',
      ],
    },
    {
      heading: '١٧. أذونات تطبيق الهاتف',
      paragraphs: [
        'عند تثبيت تطبيق Scholify على الهاتف، قد يطلب أذونات الجهاز التالية. يمكنك منحها أو رفضها أو إلغاؤها في أي وقت من خلال إعدادات نظام التشغيل لديك؛ وقد يؤدي ذلك إلى تعطيل الميزة المرتبطة.',
      ],
      list: [
        'الإشعارات — لإيصال تنبيهات الواجبات والحضور والإعلانات والمحادثات.',
        'الموقع لأولياء الأمور — فقط عند الضغط على "تعيين نقطة الاستلام". نستخدم القراءة لمرة واحدة لحفظ إحداثيات الاستلام. ولا نقوم بتتبع أولياء الأمور في الخلفية. يمكن لأولياء الأمور أيضاً رؤية موقع الباص على خريطة مباشرة أثناء الرحلة؛ ولا يتطلب ذلك مشاركة موقع ولي الأمر.',
        'الموقع للسائقين — أثناء تنفيذ الرحلة، يشارك التطبيق GPS لتحديث الخريطة المباشرة لأولياء الأمور. وعلى نظام Android قد يطلب نظام التشغيل إذن الموقع في الخلفية للحفاظ على تحديث الخريطة المباشرة عندما لا يكون التطبيق في الواجهة خلال الرحلة. وتتوقف مشاركة الموقع عند إنهاء الرحلة.',
        'مكتبة الصور والكاميرا — فقط عند اختيار رفع صورة ملف شخصي أو إرفاق صورة. ولا نصل إلى صورك في غير ذلك.',
      ],
    },
    {
      heading: '١٨. التخزين على جهازك',
      paragraphs: [
        'لا تستخدم Scholify ملفات تعريف ارتباط للتتبع من طرف ثالث أو للإعلانات. وتستخدم تطبيقات الويب وتطبيق الهاتف الحدّ الأدنى من التخزين للتشغيل:',
      ],
      list: [
        'الويب — يحفظ التخزين المحلي (localStorage) أو تخزين الجلسة (sessionStorage) رمز وصول JWT ورمز التحديث وتفضيل اللغة. وقد يُخزَّن أيضاً تجزئة لجهاز موثوق إن أشرت إلى "تذكّر هذا المتصفح".',
        'الهاتف — يحفظ AsyncStorage رموز المصادقة ذاتها، وتفضيل اللغة، وعلامة قبولك للموافقة، ورمز الإشعارات الصادر عن Expo/Apple/Google.',
      ],
    },
    {
      heading: '١٩. الاحتفاظ بالبيانات',
      list: [
        'الحسابات النشطة — تُحفظ البيانات طالما الحساب نشط ولم تطلب المدرسة حذفها.',
        'الطلاب والموظفون المؤرشفون — عند مغادرة طالب أو موظف، يجوز للمدرسة أرشفة السجل. وتُحفظ السجلات المؤرشفة كسجل تاريخي للمدرسة إلى أن تختار المدرسة تطهيرها، مع مراعاة أي التزامات قانونية للاحتفاظ.',
        'السجلات الحية المحذوفة — تُزال من قاعدة البيانات الحية خلال ٣٠ يوماً من الحذف، إلا حيث يُلزم القانون أو التدقيق بالاحتفاظ.',
        'النسخ الاحتياطية المشفّرة — تُحتفظ في Backblaze B2 لمدة تصل إلى ٩٠ يوماً ضمن نافذة دوّارة. وتنعكس عمليات الحذف من النظام الحي على النسخ الاحتياطية عند انقضاء كل نسخة من النافذة.',
        'رموز التحقق (الهاتف) — مُجزَّأة أثناء التخزين؛ وتنتهي صلاحيتها بعد ٥ دقائق. وتُحتفظ أحداث تسليم الـ webhook لأغراض التشخيص التشغيلي والمراجعة الأمنية.',
        'سجل التدقيق المُربط بسلسلة هاش — مكتوب إلحاقاً ولا يُحذف. انظر القسم التالي لكيفية تأثير ذلك على حق المحو.',
        'رسائل المحادثات — تُحفظ لسجل المدرسة. وعند تعديل رسالة أو حذفها من العرض، يُحفظ السجل الأساسي لفترة محدودة لمراجعة الإشراف قبل التطهير النهائي.',
        'GPS للباصات — يُعرض الموقع لحظياً أثناء الرحلة. ونحتفظ بسجل مختصر مرتبط بالرحلة لمراجعتها وحل النزاعات؛ ولا نحتفظ بسجلات مواقع طويلة الأمد للأفراد.',
      ],
    },
    {
      heading: '٢٠. حقوقك',
      paragraphs: [
        'لك الحق في:',
      ],
      list: [
        'الاطلاع — الحصول على نسخة من المعلومات الشخصية التي نحتفظ بها عنك.',
        'التصحيح — تصحيح المعلومات غير الدقيقة.',
        'الحذف — طلب حذف معلوماتك (وفق الحدود الموضّحة في القسم التالي).',
        'النقل — الحصول على بياناتك بصيغة قابلة للنقل.',
        'الاعتراض — على استخدام محدد لمعلوماتك.',
        'سحب الموافقة — في أي وقت ولأي استخدام يعتمد على موافقتك.',
        'تقديم شكوى لدى سلطة إشرافية تختصّ بالمعالجة.',
      ],
    },
    {
      heading: '٢١. كيفية ممارسة حقوقك',
      paragraphs: [
        'بالنسبة للبيانات التي تتحكّم بها المدرسة (سجلات الطلاب وأولياء الأمور والاتصالات المدرسية وسجلات الموظفين)، يرجى التواصل مع مدير المدرسة أولاً. وسترد المدرسة مباشرة وقد توجّه الطلب إلينا إن لزم الأمر.',
        'بالنسبة للبيانات التي نتحكّم بها (كلمة مرورك، إعدادات المصادقة متعدّدة العوامل لديك، بيانات الاتصال التي قدّمتها لنا، سجلات جهات الاتصال التسويقية)، أرسل بريداً إلى privacy@scholify.krd.',
        'نهدف إلى الإقرار باستلام الطلبات خلال ١٤ يوماً والاستجابة الجوهرية خلال ٣٠ يوماً. وقد نطلب إثباتاً للهوية قبل تنفيذ الطلبات الحسّاسة. ولا توجد رسوم على الطلبات المعقولة.',
      ],
    },
    {
      heading: '٢٢. حدود حق المحو',
      paragraphs: [
        'نلبّي طلبات المحو قدر الإمكان، إلا أن بنية المنصة والتزامات المدرسة تفرض ثلاثة قيود:',
      ],
      list: [
        'سجل التدقيق المرتبط بسلسلة هاش — لا تُحذف الإدخالات، لأن ذلك يكسر ضمان مقاومة العبث الذي يحمي كل مدرسة من التغييرات غير المُصرَّح بها. وعند طلب محو بياناتك، نستبدل الحقول المُعرِّفة بشواهد غير مُعرِّفة بدلاً من حذف الإدخالات.',
        'النسخ الاحتياطية المشفّرة — تتّبع نسخ Backblaze B2 الاحتياطية نافذة احتفاظ دوّارة لمدة ٩٠ يوماً. وتنعكس عمليات الحذف من النظام الحي على النسخ الاحتياطية عند انقضاء كل نسخة من النافذة.',
        'الاحتفاظ القانوني والمحاسبي — تخضع بعض السجلات (المعاملات المالية، إقرارات الموظف، الرواتب، الإقرارات التنظيمية) لالتزامات احتفاظ منفصلة تتعيّن على المدرسة الوفاء بها. وسنوضّح القيد المنطبق عند الرد على طلبك.',
      ],
    },
    {
      heading: '٢٣. خروقات البيانات',
      paragraphs: [
        'في حال علمنا بخرق للبيانات الشخصية يُرجَّح أن يؤثّر عليك، سنُبلِغ مدير المدرسة المعنية دون تأخير غير مبرَّر، وعلى أي حال خلال ٧٢ ساعة من العلم بالخرق، تماشياً مع المهل المتوقعة بموجب المادة ٣٣ من اللائحة. وسيتضمّن الإخطار من التفاصيل ما يكفي للمدرسة لتقييم الأثر وإبلاغ المستخدمين المعنيين أو الجهات التنظيمية عند الاقتضاء.',
      ],
    },
    {
      heading: '٢٤. تغييرات على المعالجين الفرعيين',
      paragraphs: [
        'عند إضافة معالج فرعي أو إزالته أو تغييره بشكل جوهري، نحدّث القائمة في القسم ١٤ ونعرض إخطاراً في المنصة. ويعكس تاريخ آخر تحديث في أعلى هذه السياسة آخر تغيير. وننصح بمراجعة القائمة دورياً.',
      ],
    },
    {
      heading: '٢٥. مسؤوليات المدارس المنفصلة',
      paragraphs: [
        'تقرر كل مدرسة من هم الموظفون ومن لهم أي دور وما المعلومات التي تُدخل في المنصة، وكيفية الوفاء بالتزاماتها الخاصة بالاحتفاظ والاتصال. وتظل الالتزامات القطاعية (قواعد السجلات التعليمية وسجلات حماية الطفل والرواتب والضرائب) من مسؤولية المدرسة.',
      ],
    },
    {
      heading: '٢٦. تغييرات على هذه السياسة',
      paragraphs: [
        'قد نقوم بتحديث هذه السياسة مع تطور الخدمة. وسيتم إبلاغ التغييرات الجوهرية عبر المنصة. ويُعدّ استمرار استخدام الخدمة بعد تغيير جوهري إقراراً بالسياسة المحدّثة.',
      ],
    },
    {
      heading: '٢٧. التواصل',
      paragraphs: [
        'استفسارات الخصوصية وطلبات أصحاب البيانات: privacy@scholify.krd',
        'القانوني: legal@scholify.krd',
        'التواصل العام: onboarding@scholify.krd',
        'العنوان البريدي: راست ناصر، أربيل، إقليم كردستان العراق.',
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
        'ئەم سیاسەتی تایبەتمەندییە ڕوون دەکاتەوە کە چۆن Scholify ("ئێمە") مامەڵە لەگەڵ زانیاریدا دەکات کاتێک قوتابخانەیەک پلاتفۆڕمی بەڕێوەبردنی قوتابخانەی ئێمە بەکار دەهێنێت. ئەپلیکەیشنی وێب، ئەپلیکەیشنی مۆبایل، دەرگای ئەکادیمی و دەرگای سەرەکی دەگرێتەوە. Scholify لەلایەن ڕاست ناسرەوە وەک گەشەپێدەرێکی تاکەکەسی لە هەرێمی کوردستانی عێراق بەڕێوە دەبرێت. پرسیار، داواکاریەکانی خاوەنی داتا و ئاگاداریە یاساییەکان دەکرێت بنێردرێن بۆ ئەو ناونیشانانەی لە بەشی پەیوەندی لە کۆتایی ئەم سیاسەتە.',
      ],
    },
    {
      heading: '٢. ئەو ستانداردانەی شوێنیان دەکەوین',
      paragraphs: [
        'لە ئێستادا عێراق یاسایەکی فیدراڵی تەواوی پاراستنی داتای نییە. هەرێمی کوردستان چوارچێوەی یاسایی تایبەت بە خۆی هەیە کە لە گەشەکردندایە. ئێمە بە ئاگاوە ڕێوشوێنەکانمان لەگەڵ ستانداردە نێودەوڵەتییە بەرفراوانەکاندا ڕێک دەخەین — بە تایبەتی پرەنسیپەکانی یاسای گشتی پاراستنی داتای یەکێتیی ئەوروپا (GDPR) — بە کۆکردنەوەی کەمی داتا، سنووردارکردنی مەبەست، یەکپارچەیی و نهێنی، و دانی کۆنترۆڵی واقیعی بە کەسەکان بەسەر زانیاری خۆیاندا.',
        'ئەگەر قوتابخانەیەک ژێر یاسا ناوخۆییە توندوتۆڵترەکاندا کاربکات، بەرپرسیارێتی پابەندبوونی کەرتیی خۆی لەسەر قوتابخانە دەمێنێتەوە. ئێمە پاڵپشتی قوتابخانەکان دەکەین بۆ پابەندبوون بەو ئەرکانە.',
      ],
    },
    {
      heading: '٣. کۆنترۆڵکار و پرۆسێسکار',
      paragraphs: [
        'بۆ زۆربەی داتای پلاتفۆڕم — تۆمارەکانی قوتابیان، ئامادەبوون، نمرەکان، وردەکاری دایک و باوکان و کارمەندان، نامەکانی بەڕێوەبراوی قوتابخانە — قوتابخانە کۆنترۆڵکاری داتایە، و Scholify وەک پرۆسێسکار کار دەکات لەسەر ڕێنماییەکانی قوتابخانە. ئەمە ڕێکخستنە باوەکەی نەرمەکاڵای بەڕێوەبردنی قوتابخانەیە.',
        'بۆ کۆمەڵە بچووکتری داتاکان کە ڕاستەوخۆ لە خەڵک کۆ دەکەینەوە کە لەگەڵماندا کاردەکەن (داواکاری دیمۆ، داواکاری هاوبەشی، فۆڕمەکانی پەیوەندی و تۆمارەکانی ئاسایشی هەژمار وەک تێپەڕەوشە و ڕێکخستنی فاکتەرە فرەکان)، Scholify خۆی کۆنترۆڵکارە.',
        'لە کاتێکدا قوتابخانە کۆنترۆڵکار بێت، پێویستە داواکاریەکانی دیتن، ڕاستکردنەوە، هاوردەکردن یان سڕینەوە یەکەم جار بۆ قوتابخانە بنێردرێن؛ و ئێمە یارمەتیی قوتابخانە دەدەین لە وەڵامدانەوەدا.',
      ],
    },
    {
      heading: '٤. کێ Scholify بەکار دەهێنێت',
      paragraphs: [
        'Scholify بۆ قوتابخانەکان دابین دەکرێت. بەکارهێنەرانی ئەمانەن: بەڕێوەبەران، مامۆستایان، سەرپەرشتیاران، ژمێریاران، کارمەندانی پێشوازی، دایک و باوکان و شۆفێرەکان. قوتابیان هەژماری تایبەت بە خۆیان وەرناگرن. زانیاری قوتابیان لەلایەن کارمەندانی قوتابخانەوە دەخرێتە ناو سیستم و تەنها بۆ ڕۆڵە پەیوەندیدارەکان لەناو ئەو قوتابخانەدا پیشان دەدرێت.',
      ],
    },
    {
      heading: '٥. ئەو زانیاریانەی کۆیان دەکەینەوە',
      paragraphs: [
        'دەربارەی هەژمارەکەت:',
      ],
      list: [
        'ناو، ناوی بەکارهێنەر، ڕۆڵ، قوتابخانە، زمانی هەڵبژێردراو.',
        'تێپەڕەوشە (بە bcrypt هەش کراوە دەخرێتە سەر؛ هەرگیز وەک دەقی ساف نییە).',
        'ژمارەی مۆبایل — بە فۆڕماتی نێودەوڵەتی هەڵدەگیرێت. بۆ گەیاندنی کۆدی پشتڕاستکردنەوەی یەکجارە بۆ پشتڕاستکردنەوەی ژمارە، گەڕاندنەوەی تێپەڕەوشە و چوونەژوورەوەی دوو هەنگاو بەکار دەهێنرێت.',
        'ناونیشانی ئیمەیڵ (ئاراستەیی) — بۆ گەڕاندنەوەی تێپەڕەوشە، ئاگادارکردنەوەی ئاسایش، و وەک کەناڵی پاراستن بۆ گەیاندنی کۆدی پشتڕاستکردنەوە.',
        'وێنەی پرۆفایل، ئەگەر بەرزی بکەیتەوە.',
        'تۆکنی push notification لەسەر ئامێرەکانی کە تێیدا ئەپ تەرکیب دەکەیت.',
        'ناونیشانی IP، جۆری وێبگەڕ و ئامێر، و لۆگی بنەڕەتی پێویست بۆ کارکردن و ئاسایشی خزمەتگوزاری.',
      ],
    },
    {
      heading: '٦. کۆدەکانی پشتڕاستکردنەوە و توخمەکانی ئەسلەنیێتی',
      list: [
        'کۆدی پشتڕاستکردنەوەی یەکجارە: کۆدی ٦ ژمارەیی کە کاتێک ژمارەی مۆبایل پشتڕاست دەکەیت، یان تێپەڕەوشە دەگەڕێنیتەوە، یان چوونەژوورەوەی دوو هەنگاو تەواو دەکەیت دروست دەکرێت. تەنها نوسخەیەکی هەش کراو هەڵدەگرین؛ کۆدی ساف بۆ تۆ دەنێردرێت و دواتر لە سێرڤەرەکانمان دەسڕێتەوە. تەمەنی کۆدەکان دوای ٥ خولەک بەسەر دەچێت. هەوڵی هەڵە دووبارە کۆدەکە دەسوتێنێت.',
        'نهێنیەکانی فاکتەری دووانە: ئەگەر کۆدی ئەپی پشتڕاستکردنەوە (TOTP) چالاک بکەیت، نهێنییەکە لە کاتی هەڵگرتندا بە AES-256-GCM کۆد دەکرێت. کۆدەکانی گەڕاندنەوەش لە کاتی هەڵگرتندا هەش کراون.',
        'تۆکنەکانی ئامێری متمانەپێکراو: ئەگەر تۆ "ئەم وێبگەڕە بهێنە ئەژێرە" نیشانە بکەیت، تۆکنێکی هەڕەمەکی دروست دەکرێت، نرخی هەش کراوی دەخرێتە سەر، و تۆکنی ساف تەنها لەسەر ئامێرەکەت دەمێنێتەوە.',
        'دانیشتنەکان: تۆکنە کورت تەمەنەکانی JWT بەکار دەهێنین لەگەڵ تۆکنە سواری گۆڕاوەکان. لە ڕێکخستنەکانی هەژمار دەتوانیت دانیشتنەکان ببینیت و بسڕیتەوە.',
      ],
    },
    {
      heading: '٧. زانیاری پەیوەست بە قوتابیان',
      paragraphs: [
        'قوتابخانەکان زانیاری قوتابیان ڕاستەوخۆ دەخەنە ناو پلاتفۆڕم. ئێمە ئەم زانیاریانە بە ناوی قوتابخانەوە مامەڵەی لەگەڵدا دەکەین. زۆرجار ئەمانە دەگرێتەوە:',
      ],
      list: [
        'ناو، تەمەن، پۆلی دیاریکراو، بەستەنی دایک و باوک.',
        'وێنەی پرۆفایل و پەیوەندیی فریاگوزاری (ئەگەر قوتابخانە تۆماری بکات).',
        'ئامادەبوون، نمرەکان، ڕاپۆرتەکان، ئەتیکێتی ڕەفتار، تێبینیە چیرۆکیەکان.',
        'دۆخی ئەرکی ماڵەوە و تکالیف، لەگەڵ بەروارەکان و هەر سەرنجێکی مامۆستا.',
        'کۆردیناتی خاڵی وەرگرتنی ماڵ، ئەگەر دایک و باوک بۆ تایبەتمەندی شوێنپێهەڵگرتنی پاس پاشەکەوتی بکات.',
        'نامەکانی چات لە نێوان بەکارهێنەرانی قوتابخانە کە ناوی قوتابی دەهێنن یان دەربارەی ئەو دەدوێن.',
      ],
    },
    {
      heading: '٨. زانیاری پەیوەست بە کارمەندان',
      paragraphs: [
        'بۆ کارمەندان، قوتابخانەکان دەتوانن زانیاری سەرچاوە مرۆییەکان لە ڕێگەی تایبەتمەندیەکانی پرۆفایلی کارمەند تۆمار بکەن. هەندێ خانە وەک دەقی ساف لەناو پاشخانی قوتابخانە هەڵدەگیرێن؛ هەندێی تر بەهۆی هەستیاریان لە کاتی هەڵگرتندا کۆد دەکرێن:',
      ],
      list: [
        'خانەکانی دەقی ساف (بۆ HR ی نێو قوتابخانە دیارن): ژمارەی مۆبایل، ئیمەیڵ، ناونیشان، بەرواری دامەزراندن، ژمارەی نیشتمانی، تەمەن، باری ژیان، ڕەگەز، جۆری دامەزراندن، شایستەییەکان، تێبینیەکان، وێنەی فەرمی.',
        'خانە کۆدکراوەکان لە کاتی هەڵگرتندا (بۆ HR ی نێو قوتابخانە دیارن، لە چینی هەڵگرتندا کۆد کراون): ناوی دایک/باوک/هاوسەر، ژمارەی IBAN ی بانک، ژمارەی باج، ژمارەی بیمەی کۆمەڵایەتی، ئاین. ئەمانە AES-256-GCM بەکار دەهێنن لەگەڵ کلیلی تایبەت بە هەر قوتابخانەیەک کە لە ڕێگەی HKDF داڕێژراون.',
        'لۆگی کارەکانی HR: ئاگادارکردنەوەکان، هەڵسەنگاندنی پەرفۆرمانس، کۆتاییهێنانی خزمەت، و ڕووداوە هاوشێوەکانی چەرخی ژیانی کارمەند.',
        'سکاناوەی بەڵگەنامەکانی ناسنامە کە لەلایەن HR ەوە بەرز دەکرێتەوە وەک فایل پەیوەست بە تۆماری کارمەند هەڵدەگیرێن.',
      ],
    },
    {
      heading: '٩. داتای کاتەگۆری تایبەت و هەستیار',
      paragraphs: [
        'هەندێک لەو داتایانەی سەرەوە وەسف کراون "کاتەگۆری تایبەت" بە پێی GDPR یان بە شێوەیەکی تر هەستیارن — بە تایبەتی ئاین، ناسنامەکانی نیشتمانی، وردەکاری بانکی، و هەر زانیارییەکی پەیوەست بە تەندروستی کە ڕەنگە لە تێبینیەکانی پەیوەندیی فریاگوزاری یان هۆکارەکانی غیاب دەربکەوێت.',
        'ئەم داتایانە تەنها لەسەر ڕێنماییەکانی قوتابخانە و بۆ مەبەستەکانی HR و کارگێڕی پرۆسێس دەکەین، و کۆدکردن لە کاتی هەڵگرتندا بەکار دەهێنین بۆ خانە لە ئاستی هەستیاری بەرز (ئاین، ژمارەی بیمەی کۆمەڵایەتی، IBAN، ژمارەی باج). دەستپێگەیشتن سنووردارە بۆ ڕۆڵی کارمەندی HR لەنێو قوتابخانە.',
      ],
    },
    {
      heading: '١٠. چۆن زانیاری بەکار دەهێنین و بنەمای یاسایی',
      paragraphs: [
        'زانیاری بەکار دەهێنین بۆ کارپێکردنی ئەو خزمەتگوزارییەی قوتابخانە داوای کردووە: پشتڕاستکردنەوەی بەکارهێنەران، گەیاندنی نامە و ئاگادارکردنەوەکان، ژماردنی نمرە و ڕاپۆرتەکان، پیشاندانی شوێنی پاسەکە بۆ دایک و باوکی گونجاو لە کاتی گونجاو، پاراستنی ئاسایشی پلاتفۆڕم و بەڕێوەبردنی کارەکانمان.',
        'لە کاتی جێبەجێبوونی چوارچێوەی GDPR، ئەو بنەما یاساییانەی پشتیان پێ دەبەستین ئەمانەن:',
      ],
      list: [
        'جێبەجێکردنی گرێبەست — بۆ پێشکەشکردنی ئەو خزمەتگوزارییەی قوتابخانە بەشدارییت لێ کردووە بە ناوی تۆوە، بە دەلالەی پشتڕاستکردنەوە و نامەنواردن و کارە سەرەکیەکانی قوتابخانە (مادە ٦(١)(ب)).',
        'بەرژەوەندی یاسایی — بۆ پاراستنی ئاسایشی پلاتفۆڕم، ڕێگرتن و لێکۆڵینەوە لە دەستکاری، و بەڕێوەبردنی کارەکانمان (مادە ٦(١)(و)).',
        'ئەرکی یاسایی — بۆ هەڵگرتنی تۆمارە دیاریکراوەکان کە قوتابخانە یان ئێمە لە ڕووی یاساوە پێویستە هەڵگرین (مادە ٦(١)(ج)).',
        'ڕەزامەندی — بۆ تایبەتمەندی ئاراستەیی وەک push notifications، پەیوەندیی بازرگانی دەربارەی Scholify و هەر کووکیزێکی نائاسایی (مادە ٦(١)(أ)).',
        'بۆ داتای کاتەگۆری تایبەت — ڕەزامەندی ڕوون یان ئەرکەکانی دامەزراندن و پاراستنی کۆمەڵایەتی (مادە ٩(٢)(أ) یان ٩(٢)(ب)).',
      ],
    },
    {
      heading: '١١. ئەو شتانەی هەرگیز ناکەین',
      list: [
        'ئێمە زانیاری کەسی نافرۆشین.',
        'ئێمە ڕیکلام پیشان نادەین و زانیاری لەگەڵ ڕیکلامکاران یان دەلالەکانی داتا هاوبەش ناکەین.',
        'ئێمە زانیاری کەسی بۆ ڕاهێنانی مۆدێلەکانی AI بەکار ناهێنین.',
        'ئێمە داتای قوتابخانەیەک تێکەڵ ناکەین لەگەڵ داتای قوتابخانەیەکی تردا. هەموو تۆمارێک بە قوتابخانەی خۆیەوە بەستراوەتەوە و لە ڕێگەی پشکنینی سنووری قوتابخانە لە هەر داواکارییەک و هەروەها ئاسایشی ئاستی ڕیز لە بنکەی داتادا جێبەجێ دەکرێت.',
      ],
    },
    {
      heading: '١٢. داتای منداڵان',
      paragraphs: [
        'Scholify مامەڵە لەگەڵ زانیاری منداڵاندا دەکات چونکە قوتابخانەکان مامەڵە لەگەڵ زانیاری منداڵاندا دەکەن. قوتابخانە کۆنترۆڵکارە و Scholify پرۆسێسکارە. ئەو زانیاریانەی دەربارەی قوتابیان مامەڵەیان لەگەڵدا دەکەین ئەمانە دەگرێتەوە: ناو، تەمەن، وێنە، پۆل، ئامادەبوون، نمرەکان، ڕاپۆرتە چیرۆکیەکان و ئەتیکێتی ڕەفتار، تێبینیەکانی پەیوەندیی فریاگوزاری، دۆخی ئەرکی ماڵەوە، و ئەگەر دایک و باوک تایبەتمەندی شوێنپێهەڵگرتنی پاس چالاک بکات، کۆردیناتی خاڵی وەرگرتنی خێزانەکە.',
        'قوتابیان هەژماری خۆیان لە Scholify نییە. ئێمە ڕاستەوخۆ لەگەڵ قوتابیاندا پەیوەندی ناکەین. ئاگادارکردنەوەکان، کۆدی پشتڕاستکردنەوە و پەیوەندیەکانی هەژمار بۆ دایک و باوک یان سەرپەرشتیار لەسەر هەژماری دایک و باوک دەنێردرێن. ئێمە داتای منداڵان نافرۆشین و لەگەڵ ڕیکلامکارانیشدا هاوبەشی ناکەین و هەرگیز بۆ ڕاهێنانی مۆدێلەکانی AI بەکاریان ناهێنین.',
        'مافەکانی دایک و باوک — لەوانە مافی دیتن، ڕاستکردنەوە یان داواکاری سڕینەوەی زانیاری دەربارەی منداڵ — زۆرجار دەبێت لە ڕێگەی قوتابخانەوە وەک کۆنترۆڵکار بەکار بهێنرێن. ئێمە پاڵپشتی قوتابخانە دەکەین لە جێبەجێکردنی ئەو داواکاریانە.',
      ],
    },
    {
      heading: '١٣. پشتڕاستکردنەوەی ژمارەی مۆبایل و چوونەژوورەوەی دوو هەنگاو',
      paragraphs: [
        'کۆدی پشتڕاستکردنەوەی یەکجارە لە ڕێگەی WhatsApp دەگەیەنین لە ڕێی OTPIQ ، دەرگای پشتڕاستکردنەوەی ئێمە کە لە عێراق دانیشتووە (https://otpiq.com). دواتر OTPIQ نامەکە لە ڕێی Meta Platforms Ireland Limited (WhatsApp) لە بەشی کۆتاییدا دەگوازێتەوە. ئەگەر گەیاندنی WhatsApp شکست بهێنێت یان تۆ WhatsApp چالاک نەکرابێت، ئێمە بۆ ئیمەیڵ لە ڕێی Resend دەچینەوە، بەو مەرجەی ئیمەیڵێکی تۆمارکراوت هەبێت.',
        'کاتێک کۆدێک دەنێرین، ژمارەی مۆبایل (بە فۆڕماتی نێودەوڵەتی) و کۆدەکە بۆ OTPIQ دەگوازینەوە. OTPIQ هەروەها لە ڕێگەی webhook ێکی واژۆکراوەوە دۆخی گەیاندن وەرگیراو بەرپێ دەنێرێتەوە بۆ ئەوەی بزانین پێویستە دووبارە هەوڵبدەینەوە یان شوێنپێی ئیمەیڵ چالاک بکەین. کۆدەکە هەروەها لەسەر سێرڤەرەکانمان بە شێوەی هەش کراو دەهێڵدرێتەوە بە تەمەنی پێنج خولەکی بەسەرچوون تا کاتێک تۆ دەینوسیت یان تەمەنی بەسەر دەچێت.',
        'لەوانەیە کرێی ئاسایی هێڵگری یان نامەکان لە لایەنی WhatsApp ـەوە بکەوێتە سەرت؛ ئەمە لە نێوان تۆ و دابینکەری مۆبایلتە. گەیاندنی WhatsApp خۆی ضمانی نییە — ئەگەر کۆدێکت وەرنەگرت، کۆدێکی نوێ داوا بکە یان شوێنپێی ئیمەیڵ بەکار بهێنە ئەگەر هەژمارەکەت ئیمەیڵی هەبێت.',
      ],
    },
    {
      heading: '١٤. پرۆسێسکارە لاوەکیەکان',
      paragraphs: [
        'ئێمە پشت دەبەستین بە ژمارەیەکی کەمی دابینکەرانی متمانەپێکراوی بنیاتنانی ئامێر بۆ کارکردنی خزمەتگوزاری. ئەوان داتا تەنها بەپێی ڕێنماییەکانی ئێمە پرۆسێس دەکەن:',
      ],
      list: [
        'Supabase (ویلایەتە یەکگرتووەکان / یەکێتیی ئەوروپا) — بنکەی داتای Postgres، گەنجینەی فایل و بنەماکانی پشتڕاستکردنەوە.',
        'Railway (ویلایەتە یەکگرتووەکان) — هۆستکردنی Backend ی API.',
        'Vercel (ویلایەتە یەکگرتووەکان / یەکێتیی ئەوروپا) — هۆستکردنی وێبسایتی گشتی، دەرگای قوتابخانە و دەرگای ئەکادیمی.',
        'Cloudflare (جیهانی) — DNS، CDN، و ڕێنمایی ئیمەیڵی هاتوو بۆ ناونیشانەکانی scholify.krd (support@، onboarding@، contact@، partner@). نامەکانی هاتوو لەلایەن Cloudflare Worker ـەوە شیکار دەکرێن پێش گەیاندنی بۆ Backend ـی ئێمە.',
        'GitHub Actions (ویلایەتە یەکگرتووەکان) — لۆلەی یەکپارچەکردن و دانانی بەردەوام.',
        'Expo (ویلایەتە یەکگرتووەکان) — گەیاندنی ئەپی مۆبایل (نوێکردنەوەی OTA) و ڕێنمایی push notifications.',
        'خزمەتی Apple Push Notification (ویلایەتە یەکگرتووەکان، لاوەکیی Expo) — گەیاندنی push لەسەر iOS.',
        'Firebase Cloud Messaging لە Google (ویلایەتە یەکگرتووەکان / یەکێتیی ئەوروپا، لاوەکیی Expo) — گەیاندنی push لەسەر Android.',
        'OTPIQ (عێراق) — دەرگای پشتڕاستکردنەوەی WhatsApp بۆ پشتڕاستکردنەوەی ژمارە، گەڕاندنەوەی تێپەڕەوشە و چوونەژوورەوەی دوو هەنگاو.',
        'Meta Platforms Ireland Limited / WhatsApp (ئیرلەند، لاوەکیی OTPIQ) — گەیاندنی نامەکانی پشتڕاستکردنەوە لە بەشی کۆتاییدا.',
        'Resend (ویلایەتە یەکگرتووەکان) — ئیمەیڵی دەرچوو: داواکاری دیمۆ، داواکاری هاوبەشی، ئاگادارکردنەوەی نوێکردنەوەی تێپەڕەوشە، ئاگادارکردنەوەی ئاسایش، شوێنپێی ئیمەیڵ بۆ کۆدی پشتڕاستکردنەوە، و وەڵامی ئۆپەرەیتەر بۆ نامەکانی پشتیوانی.',
        'Google Maps (ویلایەتە یەکگرتووەکان / یەکێتیی ئەوروپا) — نەخشە و گەڕان بەدوای ناونیشان بۆ شوێنپێهەڵگرتنی پاس و ڕێکخستنی خاڵی وەرگرتن.',
        'Backblaze B2 (ویلایەتە یەکگرتووەکان) — نوسخەی پاشەکەوتی شەوانە کۆد کراو. داتاکە لە لایەنی ئێمەوە بە age + AES کۆد دەکرێت پێش جێهێشتنی بنیاتمان؛ Backblaze تەنها دەقی کۆد کراو هەڵدەگرێت.',
      ],
    },
    {
      heading: '١٥. شوێنی هەڵگرتنی داتا',
      paragraphs: [
        'پرۆسێسی سەرەکی لەسەر ئەو بنیاتە هەورییە ڕوو دەدات کە لەلایەن پرۆسێسکارانی لاوەکی سەرەوەوە بەڕێوە دەبرێت، بە زۆری لە سەنتەرە داتاکانی ویلایەتە یەکگرتووەکان و یەکێتیی ئەوروپا. تاکە حاڵەتێک جیاوازی هەیە: کاتێک کۆدێکی پشتڕاستکردنەوەی WhatsApp دەگەیەنین، ژمارەی مۆبایل و کۆدەکە لە عێراق لەلایەن OTPIQ ـەوە پرۆسێس دەکرێن پێش گواستنەوەیان بۆ WhatsApp.',
        'نوسخەکانی پاشەکەوتی کۆد کراو لە Backblaze B2 وەک دەقی کۆد کراو هەڵدەگیرێن. هەموو پەیوەندییەکان لە کاتی گواستنەوەدا کۆد کراون (HTTPS/TLS).',
      ],
    },
    {
      heading: '١٦. ئاسایش',
      paragraphs: [
        'ئێمە چەند چینێک پاراستن جێبەجێ دەکەین بۆ پاراستنی داتای کەسی. هیچ خزمەتگوزارییەک نییە کە نەشڕووخێنرێت، بەڵام ئەم بەڵێنە تەکنیکیانە دەدەین و پێیان دەستەوەستان دەبین:',
      ],
      list: [
        'HTTPS/TLS بۆ هەر پەیوەندییەک نێوان ئەپەکان، Backend و پرۆسێسکارە لاوەکیەکان.',
        'تێپەڕەوشە بە bcrypt هەش دەکرێن؛ هەرگیز وەک دەقی ساف هەڵناگیرێن. هەژمارە نوێکان کە بە تێپەڕەوشەی ئاراستەیی دروست دەکرێن پێویستە لە یەکەم چوونەژوورەوەدا تێپەڕەوشەیەکی نوێ هەڵبژێرن.',
        'پشتڕاستکردنەوەی دوو فاکتەری بۆ ڕۆڵی کارمەندان بەردەستە: کۆدی ئەپی پشتڕاستکردنەوە (TOTP) لەگەڵ کۆدی گەڕاندنەوەی یەکجارە. چوونەژوورەوەی دوو هەنگاوی پشتڕاستکراو بە ژمارەی مۆبایل بۆ هەژماری دایک و باوکان و شۆفێرەکان دەسپێنرێت.',
        'نهێنیەکانی دوو فاکتەری و خانە هەڵبژێردراوەکانی کارمەند (ئاین، ژمارەی بیمەی کۆمەڵایەتی، IBAN، ژمارەی باج) لە کاتی هەڵگرتندا بە AES-256-GCM کۆد دەکرێن، بە کلیلی تایبەت بە هەر قوتابخانەیەک کە لە ڕێگەی HKDF داڕێژراون.',
        'کۆدەکانی پشتڕاستکردنەوە، کۆدەکانی گەڕاندنەوە و تۆکنەکانی ئامێری متمانەپێکراو لە کاتی هەڵگرتندا هەش کراون (sha256) بۆ ئەوەی بتوانین پشتڕاستیان بکەینەوە بەڵام ناتوانین بیخوێنینەوە.',
        'لۆگی پشتڕاستکردنەوەی ڕزگار لە دەستکاری، بەستراو بە سلسلەی هاش، بۆ کاری هەستیار (دروستکردن، نوێکردنەوە، سڕینەوە، ئەرشیفکردن).',
        'تۆکنە کورت تەمەنەکانی JWT لەگەڵ تۆکنە سواری گۆڕاوەکان، خێزانی دانیشتن، سڕینەوەی دانیشتن بەدەستی بەکارهێنەر، و سڕینەوەی خۆکارانەی دانیشتنەکان کاتێک ڕێکخستنە حەساسەکانی ئاسایش دەگۆڕێن.',
        'پشکنینی سنووری قوتابخانە لە هەر داواکارییەکدا لە ئاستی ئەپلیکەیشن و هەروەها ئاسایشی ئاستی ڕیز لە Postgres تا قوتابخانەیەک نەتوانێت داتای قوتابخانەیەکی تر بخوێنێتەوە.',
        'دیاریکردنی ڕێژەی بەکارهێنەر و IP لەسەر خاڵی کۆتایی پشتڕاستکردنەوە؛ سنووری توندتر لەسەر ناردنی کۆدی پشتڕاستکردنەوە.',
      ],
    },
    {
      heading: '١٧. مۆڵەتەکانی ئەپی مۆبایل',
      paragraphs: [
        'کاتێک ئەپی Scholify لەسەر مۆبایل تەرکیب دەکەیت، ڕەنگە داوای ئەم مۆڵەتانە بکات. هەر کاتێک دەتوانیت لە ڕێگەی ڕێکخستنەکانی سیستەمی کارپێکەرەوە بیاندەیت، ڕەتیان بکەیتەوە یان لایان ببەیت؛ ئەمە لەوانەیە تایبەتمەندی پەیوەندیدار ناکارا بکات.',
      ],
      list: [
        'Push notifications — بۆ گەیاندنی ئاگادارکردنەوەی ئەرکی ماڵەوە، ئامادەبوون، ڕاگەیاندن و چات.',
        'شوێنی دایک و باوکان — تەنها کاتێک دەستت بکوتیت لە "خاڵی وەرگرتن دانێ". ئێمە خوێندنەوەی یەکجارە بەکار دەهێنین بۆ پاشەکەوتی کۆردیناتەکانی وەرگرتن. ئێمە لە پشتەوە دایک و باوکان شوێنیان لێ ناگرین. دایک و باوکان هەروەها دەتوانن شوێنی پاسەکە لەسەر نەخشەی زیندوو ببینن لە کاتی گەشتدا؛ ئەمە پێویستی بە هاوبەشکردنی شوێنی دایک و باوک نییە.',
        'شوێنی شۆفێرەکان — لە کاتی گەشتدا، ئەپ GPS هاوبەش دەکات تا نەخشەی زیندووی پاسەکە بۆ دایک و باوکان نوێ بکرێتەوە. لەسەر Android لەوانەیە سیستەمی کارپێکەر داوای مۆڵەتی شوێنی پشتەوە بکات بۆ ئەوەی نەخشەی زیندوو بەردەوام نوێ بکرێتەوە کاتێک ئەپ لە ڕووی پێشەوەدا نییە لە کاتی گەشتدا. هاوبەشکردنی شوێن دەوەستێت کاتێک شۆفێر گەشت کۆتایی پێ دەهێنێت.',
        'گەنجینەی وێنە و کامێرا — تەنها کاتێک هەڵدەبژێریت وێنەی پرۆفایل بەرز بکەیتەوە یان وێنە هاوپێچ بکەیت. ئێمە لە غەیری ئەمە دەستمان بە وێنەکانت ناگات.',
      ],
    },
    {
      heading: '١٨. هەڵگرتن لەسەر ئامێرەکەت',
      paragraphs: [
        'Scholify کووکیزی شوێنپێهەڵگری لایەنی سێیەم یان ڕیکلام بەکار ناهێنێت. وێب ئەپەکان و ئەپی مۆبایل کەمترین هەڵگرتن بەکار دەهێنن بۆ کارکردن:',
      ],
      list: [
        'وێب — localStorage یان sessionStorage ی وێبگەڕ، تۆکنی وەرگرتنی JWT، تۆکنی تازەکردنەوە و تەرجیحی زمان هەڵدەگرێت. هاشی ئامێرێکی متمانەپێکراو لەوانەیە هەڵبگیرێت ئەگەر "ئەم وێبگەڕە بهێنە ئەژێرە" نیشانە بکەیت.',
        'مۆبایل — AsyncStorage هەمان تۆکنەکانی پشتڕاستکردنەوە، تەرجیحی زمان، ئاڵای پەسەندکردنی ڕەزامەندیت، و تۆکنی push notification ی دەرکراو لەلایەن Expo/Apple/Google هەڵدەگرێت.',
      ],
    },
    {
      heading: '١٩. هێشتنەوەی داتا',
      list: [
        'هەژمارە چالاکەکان — داتا دەهێڵدرێتەوە تا کاتێک هەژمار چالاکە و قوتابخانە داوای سڕینەوەی نەکردووە.',
        'قوتابی و کارمەندی ئەرشیفکراو — کاتێک قوتابی دەڕوات یان کارمەند ئەرشیف دەکرێت، قوتابخانە دەتوانێت تۆمارەکە ئەرشیف بکات. تۆمارە ئەرشیفکراوەکان وەک تۆماری مێژوویی قوتابخانە دەپارێزرێن تا قوتابخانە بڕیاری پاککردنەوەیان بدات، لەگەڵ ڕەچاوکردنی هەر ئەرکێکی یاسایی هێشتنەوە.',
        'تۆمارە سڕاوەکانی زیندوو — لە بنکەی داتای زیندوو لەماوەی ٣٠ ڕۆژدا لە کاتی سڕینەوەدا دەسڕێتەوە، تەنها لەو حاڵەتەی یاسا یان پشکنین داوای هێشتنەوەی بکات.',
        'نوسخەکانی پاشەکەوتی کۆد کراو — لە Backblaze B2 بۆ ماوەی تا ٩٠ ڕۆژ لە پەنجەرەی سوارەدا هەڵدەگیرێن. سڕینەوەکانی نێو سیستەمی زیندوو لە نوسخەکانی پاشەکەوتدا دەردەکەون کاتێک هەر نوسخەیەک لە پەنجەرە دەردەچێت.',
        'کۆدەکانی پشتڕاستکردنەوە (مۆبایل) — لە کاتی هەڵگرتندا هەش کراون؛ تەمەنیان دوای ٥ خولەک بەسەر دەچێت. ڕووداوەکانی گەیاندنی webhook بۆ تشخیصی کارگێڕی و پێداچوونەوەی ئاسایش هەڵدەگیرێن.',
        'لۆگی پشتڕاستکردنەوەی بەستراو بە سلسلەی هاش — تەنها بۆ زیادکردن دەنوسرێت و ناسڕێتەوە. بۆ تەواوی کارلێکی لەسەر مافی سڕینەوە بەشی داهاتوو ببینە.',
        'نامەکانی چات — بۆ تۆماری قوتابخانە هەڵدەگیرێن. کاتێک نامەیەک دەستکاری دەکرێت یان لە نمایش دەسڕێتەوە، تۆمارە سەرەکیەکە بۆ ماوەیەکی سنووردار بۆ پێداچوونەوەی ئیشراف هەڵدەگیرێت پێش پاککردنەوەی کۆتایی.',
        'GPS ی پاسەکان — شوێنی زیندوو لە کاتی گەشتدا ڕاستەوخۆ پیشان دەدرێت. ئێمە مێژووی کورتی پەیوەست بە گەشت بۆ پێداچوونەوەی گەشت و چارەسەرکردنی ناکۆکی هەڵدەگرین؛ مێژووی شوێنی درێژخایەنی تاکەکەس هەڵناگرین.',
      ],
    },
    {
      heading: '٢٠. مافەکانت',
      paragraphs: [
        'تۆ مافی ئەوەت هەیە:',
      ],
      list: [
        'دیتن — نوسخەیەک لە زانیاری کەسی کە لەلامان هەیە دەربارەی تۆ.',
        'ڕاستکردنەوە — ڕاستکردنەوەی زانیاری نادروست.',
        'سڕینەوە — داواکاری سڕینەوەی زانیاریت (لەگەڵ سنوورەکانی بەشی داهاتوو).',
        'هاوردەکراوی — وەرگرتنی داتاکەت بە فۆڕماتێکی هاوردەکراوی.',
        'دژبەرەستی — لە بەکارهێنانێکی دیاریکراوی زانیاریت.',
        'گەڕانەوەی ڕەزامەندی — لە هەر کاتێکدا، بۆ هەر بەکارهێنانێک کە بەستراوەتەوە بە ڕەزامەندیت.',
        'پێشکەشکردنی سکاڵا بۆ دەسەڵاتێکی سەرپەرشتی کە بەسەر پرۆسێسەکەدا دەسەڵاتدارە.',
      ],
    },
    {
      heading: '٢١. چۆن مافەکانت بەکار بهێنیت',
      paragraphs: [
        'بۆ داتایەی کە قوتابخانە کۆنترۆڵی دەکات (تۆمارەکانی قوتابیان، تۆمارەکانی دایک و باوکان، پەیوەندیەکانی قوتابخانە، تۆمارەکانی HR ی کارمەندان)، تکایە یەکەم جار پەیوەندی بە بەڕێوەبەری قوتابخانەکەت بکە. قوتابخانە ڕاستەوخۆ وەڵامت دەداتەوە و دەتوانێت داواکارییەکە بنێرێتە لای ئێمە ئەگەر یارمەتیمان پێویست بێت.',
        'بۆ داتایەی کە ئێمە کۆنترۆڵی دەکەین (تێپەڕەوشەی خۆت، ڕێکخستنە فرە فاکتەرەکانی خۆت، زانیاری پەیوەندیی کە تۆ دابینت کردووە، تۆمارەکانی پەیوەندیی بازرگانی)، ئیمەیڵ بۆ privacy@scholify.krd بنێرە.',
        'ئامانجمانە لە ماوەی ١٤ ڕۆژدا داواکاریەکان بپەسەنین و لە ماوەی ٣٠ ڕۆژدا وەڵامی جەوهەری بدەینەوە. لەوانەیە بەڵگەی شوناس بخوازین پێش جێبەجێکردنی داواکاری هەستیار. هیچ کرێیەک لەسەر داواکاریە لۆجیکیەکان نییە.',
      ],
    },
    {
      heading: '٢٢. سنوورەکانی مافی سڕینەوە',
      paragraphs: [
        'داواکاریەکانی سڕینەوە بەدڵ دەکەین تا ئەو ڕادەی دەکرێت، بەڵام ئاوانی پلاتفۆڕم و ئەرکەکانی قوتابخانە سێ سنووریان داناوە:',
      ],
      list: [
        'لۆگی پشتڕاستکردنەوەی بەستراو بە سلسلەی هاش — تۆمارەکان ناسڕێنەوە، چونکە ئەمە ضمانی بەرگری لە دەستکاری دەشکێنێت کە هەموو قوتابخانەیەک لە گۆڕانکارییە بێ مۆڵەتدا دەپارێزێت. کاتێک داوای سڕینەوەکەت دەکەیت، خانە ناسێنەرەکان بە نیشاندانی ناوناسێنەر دەگۆڕینەوە لە جیاتی سڕینەوەی تۆمارەکان.',
        'نوسخەکانی پاشەکەوتی کۆد کراو — نوسخەکانی Backblaze B2 بۆ پەنجەرەی سواری هێشتنەوەی ٩٠ ڕۆژەی شوێن دەکەون. سڕینەوەکانی نێو سیستەمی زیندوو لە نوسخەکانی پاشەکەوتدا دەردەکەون کاتێک هەر نوسخەیەک لە پەنجەرە دەردەچێت.',
        'هێشتنەوەی یاسایی و پشکنین — هەندێ تۆمار (مامەڵە داراییەکان، ئاگادارکردنەوەکانی کارمەند، مووچە، پێشکەشکردنە بنکەییەکان) ئەرکی هێشتنەوەی جیاوازیان هەیە کە پێویستە قوتابخانە بەجێی بهێنێت. لە کاتی وەڵامدانەوەی داواکاریتدا ڕوون دەکەینەوە کام ئەرک جێبەجێ دەکرێت.',
      ],
    },
    {
      heading: '٢٣. ڕووداوەکانی داتا',
      paragraphs: [
        'ئەگەر ئاگادار بین لە ڕووداوێکی داتای کەسی کە ڕەنگە کاریگەری لەسەر تۆ هەبێت، دەستبەجێ و بەهیچ شێوەیەک لە ماوەی ٧٢ کاتژمێر لە کاتی ئاگادارببوون بۆ ڕووداوەکە بەڕێوەبەری قوتابخانە ئاگادار دەکەینەوە، تەواو لە چوارچێوەی ڕێنماییەکانی مادە ٣٣ ی GDPR. ئاگادارکردنەوەکە دەگرێتەوە وردەکاری بەسەن بۆ قوتابخانە بۆ هەڵسەنگاندنی کاریگەری و ئاگادارکردنەوەی بەکارهێنەران یان دەسەڵاتدارانی پابەند.',
      ],
    },
    {
      heading: '٢٤. گۆڕانکاری لە پرۆسێسکارە لاوەکیەکاندا',
      paragraphs: [
        'کاتێک پرۆسێسکارێکی لاوەکی زیاد دەکەین، لا دەبەین یان بە جدی دەگۆڕین، لیستەکە لە بەشی ١٤ نوێ دەکەینەوە و ئاگادارکردنەوەیەک لە پلاتفۆڕم دەردەخەین. تاریخی نوێکردنەوەی کۆتایی لە سەرەی ئەم سیاسەتە دواین گۆڕانکاری دەنوێنێت. پێشنیار دەکەین لیستەکە بە پێبەزی بکەنەوە.',
      ],
    },
    {
      heading: '٢٥. بەرپرسیارێتیە جیاکانی قوتابخانەکان',
      paragraphs: [
        'هەر قوتابخانەیەک بڕیار دەدات کام کارمەند چ ڕۆڵێکی هەیە، چ زانیاریەک دەخرێتە ناو پلاتفۆڕم، و چۆن ئەرکەکانی هێشتنەوە و پەیوەندیی خۆی بەجێ دەهێنرێن. ئەرکە کەرتییەکان (یاساکانی تۆماری پەروەردە، تۆمارەکانی پاراستنی منداڵ، مووچە، باج) لەسەر قوتابخانە دەمێنێتەوە.',
      ],
    },
    {
      heading: '٢٦. گۆڕانکاریەکان لەم سیاسەتەدا',
      paragraphs: [
        'ڕەنگە ئەم سیاسەتە نوێ بکەینەوە لەگەڵ گەشەکردنی خزمەتگوزاری. گۆڕانکارییە گرنگەکان لە ڕێگەی پلاتفۆڕمەوە ڕادەگەیەنرێن. بەردەوامبوون لە بەکارهێنانی خزمەتگوزاری دوای گۆڕانکارییەکی گرنگ بە پەسەندکردنی سیاسەتی نوێکراوە دادەنرێت.',
      ],
    },
    {
      heading: '٢٧. پەیوەندی',
      paragraphs: [
        'پرسیارەکانی تایبەتمەندی و داواکاریەکانی خاوەنی داتا: privacy@scholify.krd',
        'یاسایی: legal@scholify.krd',
        'پەیوەندی گشتی: onboarding@scholify.krd',
        'ناونیشانی پۆست: ڕاست ناسر، هەولێر، هەرێمی کوردستانی عێراق.',
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
        'You are responsible for keeping your password and any two-factor secret or recovery codes confidential, and for activity that occurs under your account.',
        'If you believe your account has been accessed without your permission, change your password immediately and contact your school administrator.',
      ],
    },
    {
      heading: '4. Authentication and account security',
      paragraphs: [
        'We use the following authentication mechanisms. Some may be required by your school depending on your role.',
      ],
      list: [
        'Default passwords on first sign-in: when an administrator creates your account using a shipping default password, the platform requires you to choose a new password before you can use the service.',
        'Two-step sign-in: staff roles (administrator, accountant, teacher, supervisor, reception) may be required to set up an authenticator-app code (TOTP) and store the recovery codes we display once. Parent and driver roles are being added to a separate phone-based two-step sign-in flow.',
        'Phone verification and one-time codes: we deliver six-digit codes to your phone via WhatsApp through OTPIQ, with email fallback if WhatsApp delivery fails. Codes expire after five minutes and have a strict limit on incorrect attempts.',
        'Sessions: signing in issues a short-lived access token plus a rotating refresh token. You can view your active sessions and revoke any of them from account settings; revoking a session signs out that device.',
        'Trusted devices: you may mark a browser or device as trusted to reduce how often two-step sign-in prompts you. Remove a trusted device from account settings if it is lost or shared.',
      ],
    },
    {
      heading: '5. WhatsApp and SMS dependency',
      paragraphs: [
        'When verification codes are delivered by WhatsApp through OTPIQ, delivery depends on third parties (OTPIQ and Meta), on your mobile carrier, and on your device having an active WhatsApp account. We do not guarantee delivery and we are not responsible for delays or failures introduced by those third parties. If a code does not arrive, request a new one or fall back to the email channel where available.',
        'Standard carrier or messaging charges on the WhatsApp side, if any, are between you and your mobile operator.',
      ],
    },
    {
      heading: '6. School administrator responsibilities',
      paragraphs: [
        'The school is the controller of the data entered into the platform on its behalf. The school is responsible for:',
      ],
      list: [
        'Choosing which staff have which role and whether two-step sign-in is enforced.',
        'Ensuring the accuracy of records entered into the platform.',
        'Communicating with parents and staff about how the school uses the platform.',
        'Meeting any sector-specific obligations that apply to the school under local law.',
        'Responding to data-subject requests under the school\'s own privacy notice, with our assistance when needed.',
      ],
    },
    {
      heading: '7. Acceptable use',
      paragraphs: [
        'You agree not to:',
      ],
      list: [
        'Use the service to harass, threaten, or harm any person.',
        'Upload content that is unlawful, abusive, or violates the rights of others.',
        'Attempt to access data belonging to a school other than your own, or to bypass our school-scoping or row-level security.',
        'Probe, scan, or test the vulnerability of the service without our written permission.',
        'Interfere with the operation of the service or with other users\' use of it.',
        'Use the service to send unsolicited bulk messages.',
        'Request verification codes or password resets for an account you do not own, or use automated tooling to exhaust authentication or rate-limit budgets.',
        'Probe the SMS / WhatsApp gateway for fraud (for example, by requesting codes to phone numbers you do not control).',
      ],
    },
    {
      heading: '8. Your content',
      paragraphs: [
        'You retain all rights to the content you upload (messages, files, posts). You grant us a limited license to host, store, process, and display that content solely as needed to operate the service for your school. Messages you delete from the visible thread may be retained for a limited moderation-review window before final purge; this is described in the Privacy Policy.',
      ],
    },
    {
      heading: '9. Subscription and fees',
      paragraphs: [
        'Subscription terms, pricing, and payment are agreed separately between Scholify and each school. Individual users (parents, teachers, staff, drivers) are not charged by Scholify for using the service.',
      ],
    },
    {
      heading: '10. Privacy',
      paragraphs: [
        'Our handling of personal information — including the sub-processors we rely on, where data is stored, what we retain, and your rights — is described in the Privacy Policy. By using the service you acknowledge that policy.',
      ],
    },
    {
      heading: '11. Service availability',
      paragraphs: [
        'We work to keep the service running reliably, but we do not guarantee uninterrupted availability. We may schedule maintenance windows or temporarily suspend the service to make changes, fix problems, or address security issues. We may also rely on third-party providers whose own outages can affect availability.',
      ],
    },
    {
      heading: '12. Bus tracking — important',
      paragraphs: [
        'The bus tracking feature provides a best-effort estimate of bus location based on GPS data shared by drivers. It depends on cellular connectivity, GPS accuracy, the driver\'s device, and the driver actually running the app during the trip. It must not be relied on for safety-critical decisions. Always follow your school\'s standard procedures for student pickup and supervision.',
      ],
    },
    {
      heading: '13. Termination',
      paragraphs: [
        'A school may end its use of the service at any time. Individual accounts can be deactivated or archived by the school\'s administrator. We may suspend or terminate access if these Terms are violated, if there is risk of harm to other users, or if continued provision of the service is not feasible. On termination, retention of records is governed by the Privacy Policy and any agreement between the school and Scholify.',
      ],
    },
    {
      heading: '14. Disclaimers',
      paragraphs: [
        'The service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy of bus location or attendance, or non-infringement, to the maximum extent permitted by applicable law.',
      ],
    },
    {
      heading: '15. Limitation of liability',
      paragraphs: [
        'To the maximum extent permitted by applicable law, Scholify shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenue, data, or use, arising from or related to your use of the service, including any failure or delay in delivering a verification code by WhatsApp, SMS, or email. Our total aggregate liability for any claim relating to the service shall not exceed the amounts paid by your school for the service in the twelve months preceding the claim, or USD 100, whichever is greater.',
      ],
    },
    {
      heading: '16. Indemnification',
      paragraphs: [
        'You agree to indemnify and hold Scholify harmless from claims arising out of your violation of these Terms or your misuse of the service.',
      ],
    },
    {
      heading: '17. Governing law and venue',
      paragraphs: [
        'These Terms are governed by the laws applicable in the Kurdistan Region of Iraq. Disputes shall be brought before the competent courts of Erbil. Nothing in these Terms limits any non-waivable rights you may have under the law of the country in which you reside.',
      ],
    },
    {
      heading: '18. Changes',
      paragraphs: [
        'We may update these Terms as the service evolves. Material changes will be communicated through the platform. Continued use of the service after a change indicates acceptance of the updated Terms.',
      ],
    },
    {
      heading: '19. Languages',
      paragraphs: [
        'These Terms are published in English, Arabic, and Kurdish. We make reasonable efforts to keep the translations aligned, but if a material conflict between versions arises, the English version prevails.',
      ],
    },
    {
      heading: '20. Contact',
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
        'أنت مسؤول عن سرية كلمة المرور وأي أسرار للمصادقة الثنائية أو رموز الاسترداد، وعن النشاط الذي يحدث تحت حسابك.',
        'إذا كنت تعتقد أن حسابك تم الوصول إليه دون إذنك، فغيِّر كلمة المرور فوراً واتصل بمدير المدرسة.',
      ],
    },
    {
      heading: '٤. المصادقة وأمان الحساب',
      paragraphs: [
        'نستخدم آليات المصادقة التالية. وقد تكون بعضها مطلوبة من مدرستك حسب دورك.',
      ],
      list: [
        'كلمات المرور الافتراضية عند أول دخول: عند إنشاء المدير لحسابك بكلمة مرور افتراضية، تطلب منك المنصة اختيار كلمة مرور جديدة قبل استخدام الخدمة.',
        'تسجيل الدخول بخطوتين: قد يُطلب من أدوار الكادر (المدير، المحاسب، المعلم، المشرف، الاستقبال) إعداد رمز تطبيق مصادقة (TOTP) وحفظ رموز الاسترداد التي نعرضها لمرة واحدة. وتُضاف أدوار ولي الأمر والسائق إلى تدفّق منفصل لتسجيل الدخول بخطوتين عبر الهاتف.',
        'التحقق من الهاتف ورموز لمرة واحدة: نُسلّم رموزاً من ٦ أرقام إلى هاتفك عبر WhatsApp من خلال OTPIQ، مع البديل عبر البريد الإلكتروني في حال فشل تسليم WhatsApp. تنتهي صلاحية الرموز بعد ٥ دقائق ولها حدّ صارم على المحاولات الخاطئة.',
        'الجلسات: يُصدر تسجيل الدخول رمز وصول قصير العمر مع رمز تحديث دوّار. ويمكنك عرض جلساتك النشطة وإبطال أي منها من إعدادات الحساب؛ ويؤدي الإبطال إلى تسجيل خروج ذلك الجهاز.',
        'الأجهزة الموثوقة: يمكنك تعيين متصفح أو جهاز كمتصفح/جهاز موثوق لتقليل تكرار طلب تسجيل الدخول بخطوتين. وأزل الجهاز الموثوق من إعدادات الحساب إن فُقد أو شُورِك.',
      ],
    },
    {
      heading: '٥. الاعتماد على WhatsApp والرسائل القصيرة',
      paragraphs: [
        'عند تسليم رموز التحقق عبر WhatsApp من خلال OTPIQ، يعتمد التسليم على أطراف ثالثة (OTPIQ وMeta) وعلى مزوّد خدمة هاتفك وعلى وجود حساب WhatsApp فعّال على جهازك. لا نضمن التسليم ولا نتحمّل المسؤولية عن أي تأخير أو إخفاق ناتج عن تلك الأطراف. إذا لم يصل رمز، فاطلب رمزاً جديداً أو استخدم البديل عبر البريد الإلكتروني حيث كان متاحاً.',
        'قد تنطبق رسوم الناقل أو الرسائل المعتادة من جهة WhatsApp، إن وُجدت، وهي بينك وبين مزوّد خدمتك.',
      ],
    },
    {
      heading: '٦. مسؤوليات مدير المدرسة',
      paragraphs: [
        'تُعتبر المدرسة المسؤولة (المتحكمة) عن جميع البيانات المُدخلة على المنصة نيابةً عنها، وهي مسؤولة عن:',
      ],
      list: [
        'تحديد الموظفين والأدوار الممنوحة لكل منهم وما إذا كان تسجيل الدخول بخطوتين مفروضاً.',
        'ضمان دقة السجلات المُدخلة في المنصة.',
        'التواصل مع أولياء الأمور والموظفين بشأن طريقة استخدام المدرسة للمنصة.',
        'الوفاء بأي التزامات قطاعية تنطبق على المدرسة بموجب القانون المحلي.',
        'الاستجابة لطلبات أصحاب البيانات بموجب إشعار الخصوصية الخاص بالمدرسة، بمساعدتنا عند اللزوم.',
      ],
    },
    {
      heading: '٧. الاستخدام المقبول',
      paragraphs: [
        'أنت توافق على ألا:',
      ],
      list: [
        'تستخدم الخدمة لمضايقة أي شخص أو تهديده أو إيذائه.',
        'ترفع محتوى مخالفاً للقانون أو مسيئاً أو ينتهك حقوق الآخرين.',
        'تحاول الوصول إلى بيانات تخص مدرسة أخرى غير مدرستك، أو تجاوز فحوصات نطاق المدرسة أو أمان مستوى الصف لدينا.',
        'تفحص أو تختبر ثغرات الخدمة دون إذن خطي منا.',
        'تتدخل في تشغيل الخدمة أو في استخدام المستخدمين الآخرين لها.',
        'تستخدم الخدمة لإرسال رسائل جماعية غير مطلوبة.',
        'تطلب رموز التحقق أو إعادة تعيين كلمة المرور لحساب لا تملكه، أو تستخدم أدوات آلية لاستنزاف ميزانيات المصادقة أو حدود المعدّل.',
        'تستهدف بوابة الرسائل/WhatsApp لأغراض احتيالية (مثل طلب رموز إلى أرقام لا تتحكّم بها).',
      ],
    },
    {
      heading: '٨. محتواك',
      paragraphs: [
        'تحتفظ بكل حقوقك على المحتوى الذي ترفعه (الرسائل، الملفات، المنشورات). وتمنحنا ترخيصاً محدوداً لاستضافته وتخزينه ومعالجته وعرضه فقط بالقدر اللازم لتشغيل الخدمة لمدرستك. والرسائل التي تحذفها من العرض قد تُحفظ لفترة محدودة لمراجعة الإشراف قبل التطهير النهائي؛ وذلك موضّح في سياسة الخصوصية.',
      ],
    },
    {
      heading: '٩. الاشتراك والرسوم',
      paragraphs: [
        'تُتفق شروط الاشتراك والأسعار والدفع بشكل منفصل بين Scholify وكل مدرسة. ولا تُفرض رسوم من Scholify على المستخدمين الأفراد (أولياء الأمور، المعلمون، الموظفون، السائقون) لاستخدام الخدمة.',
      ],
    },
    {
      heading: '١٠. الخصوصية',
      paragraphs: [
        'يُوضَّح تعاملنا مع المعلومات الشخصية — بما في ذلك المعالجون الفرعيون الذين نعتمد عليهم ومكان تخزين البيانات وما نحتفظ به وحقوقك — في سياسة الخصوصية. باستخدام الخدمة فإنك تُقرّ بهذه السياسة.',
      ],
    },
    {
      heading: '١١. توفّر الخدمة',
      paragraphs: [
        'نسعى للحفاظ على تشغيل الخدمة بشكل موثوق، لكننا لا نضمن توفّرها دون انقطاع. وقد نُجدول فترات صيانة أو نُعلّق الخدمة مؤقتاً لإجراء تغييرات أو إصلاح مشاكل أو معالجة قضايا أمنية. كما نعتمد على مزوّدين خارجيين قد تؤثر انقطاعاتهم على التوفّر.',
      ],
    },
    {
      heading: '١٢. تتبع الباصات — مهم',
      paragraphs: [
        'تقدّم ميزة تتبع الباصات تقديراً للموقع بناءً على بيانات GPS التي يشاركها السائقون. وتعتمد على الاتصال الخلوي ودقة GPS وجهاز السائق وتشغيل التطبيق فعلياً أثناء الرحلة. ولا يجوز الاعتماد عليها في القرارات الحساسة للسلامة. التزم دائماً بإجراءات مدرستك الموحّدة لاستلام الطلاب والإشراف عليهم.',
      ],
    },
    {
      heading: '١٣. الإنهاء',
      paragraphs: [
        'يجوز للمدرسة إنهاء استخدامها للخدمة في أي وقت. ويمكن لمدير المدرسة تعطيل أو أرشفة الحسابات الفردية. وقد نُعلّق أو نُنهي الوصول في حال انتهاك هذه الشروط أو وجود خطر على المستخدمين الآخرين أو في حال تعذّر تقديم الخدمة. وعند الإنهاء، يخضع الاحتفاظ بالسجلات لسياسة الخصوصية ولأي اتفاقية بين المدرسة وScholify.',
      ],
    },
    {
      heading: '١٤. إخلاء المسؤولية',
      paragraphs: [
        'تُقدَّم الخدمة "كما هي" و"حسب التوفّر" دون أي ضمانات صريحة أو ضمنية، بما في ذلك ضمانات القابلية للتسويق أو الملاءمة لغرض معين أو دقة موقع الباص أو الحضور أو عدم الانتهاك، إلى أقصى حدّ يسمح به القانون المعمول به.',
      ],
    },
    {
      heading: '١٥. تحديد المسؤولية',
      paragraphs: [
        'إلى أقصى حدّ يسمح به القانون المعمول به، لا تتحمّل Scholify المسؤولية عن أي أضرار غير مباشرة أو عرضية أو خاصة أو تبعية أو عقابية، أو عن خسارة الأرباح أو الإيرادات أو البيانات أو الاستخدام، الناشئة عن استخدامك للخدمة، بما يشمل أي إخفاق أو تأخير في تسليم رمز تحقق عبر WhatsApp أو الرسائل القصيرة أو البريد الإلكتروني. ولا تتجاوز المسؤولية الإجمالية لأي مطالبة المبلغ الذي دفعته مدرستك مقابل الخدمة في الأشهر الاثني عشر السابقة للمطالبة، أو ١٠٠ دولار أمريكي، أيهما أكبر.',
      ],
    },
    {
      heading: '١٦. التعويض',
      paragraphs: [
        'توافق على تعويض Scholify وحمايتها من أي مطالبات ناشئة عن انتهاكك لهذه الشروط أو سوء استخدامك للخدمة.',
      ],
    },
    {
      heading: '١٧. القانون الحاكم والمحكمة',
      paragraphs: [
        'تخضع هذه الشروط للقوانين السارية في إقليم كردستان العراق. وتُرفع النزاعات أمام المحاكم المختصة في أربيل. ولا يُقيِّد أيٌّ من هذه الشروط الحقوق غير القابلة للتنازل التي قد تكفلها قوانين بلد إقامتك.',
      ],
    },
    {
      heading: '١٨. التغييرات',
      paragraphs: [
        'قد نُحدّث هذه الشروط مع تطور الخدمة. وسيتم إبلاغ التغييرات الجوهرية عبر المنصة. ويُعدّ استمرار استخدامك للخدمة بعد التغيير قبولاً للشروط المحدّثة.',
      ],
    },
    {
      heading: '١٩. اللغات',
      paragraphs: [
        'تُنشر هذه الشروط بالإنجليزية والعربية والكردية. نبذل جهداً معقولاً للحفاظ على تطابق الترجمات، فإن وُجد تعارض جوهري بين النسخ تسود النسخة الإنجليزية.',
      ],
    },
    {
      heading: '٢٠. التواصل',
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
        'تۆ بەرپرسیاریت لە پاراستنی نهێنی تێپەڕەوشە و هەر نهێنییەکی فاکتەری دووانە یان کۆدەکانی گەڕاندنەوە، و لە چالاکیەکانی ژێر هەژمارەکەت.',
        'ئەگەر پێت وایە هەژمارەکەت بەبێ مۆڵەتی تۆ گەیشتراوەتێ، تێپەڕەوشە دەستبەجێ بگۆڕە و پەیوەندی بە بەڕێوەبەری قوتابخانەوە بکە.',
      ],
    },
    {
      heading: '٤. پشتڕاستکردنەوە و ئاسایشی هەژمار',
      paragraphs: [
        'ئەم میکانیزمانەی پشتڕاستکردنەوە بەکار دەهێنین. لەوانەیە هەندێکیان پێویست بن بەپێی ڕۆڵی تۆ لە قوتابخانە.',
      ],
      list: [
        'تێپەڕەوشەی ئاراستەیی لە یەکەم چوونەژوورەوەدا: کاتێک بەڕێوەبەر هەژمارت بە تێپەڕەوشەی ئاراستەیی دروست دەکات، پلاتفۆڕم پێویست دەکات تێپەڕەوشەیەکی نوێ هەڵبژێریت پێش بەکارهێنانی خزمەتگوزاری.',
        'چوونەژوورەوەی دوو هەنگاو: لەوانەیە لە ڕۆڵی کارمەندان (بەڕێوەبەر، ژمێریار، مامۆستا، سەرپەرشتیار، پێشوازی) داوا بکرێت کۆدی ئەپی پشتڕاستکردنەوە (TOTP) ڕێک بخەن و کۆدەکانی گەڕاندنەوەی یەکجارە کە جارێک پیشانیان دەدەین پاشەکەوت بکەن. ڕۆڵی دایک و باوک و شۆفێر بۆ تەسلسلێکی جیاوازی چوونەژوورەوەی دوو هەنگاو لە ڕێگەی مۆبایلەوە زیاد دەکرێن.',
        'پشتڕاستکردنەوەی مۆبایل و کۆدی یەکجارە: کۆدی ٦ ژمارەیی بۆ مۆبایلت لە ڕێی WhatsApp و OTPIQ دەگەیەنین، لەگەڵ شوێنپێی ئیمەیڵ ئەگەر گەیاندنی WhatsApp شکست بهێنێت. کۆدەکان دوای ٥ خولەک بەسەر دەچن و سنوورێکی توندیان لەسەر هەوڵە هەڵەکان هەیە.',
        'دانیشتنەکان: چوونەژوورەوە تۆکنی وەرگرتنی کورت تەمەن لەگەڵ تۆکنی تازەکردنەوەی سواری دەرئەکات. دەتوانیت دانیشتنە چالاکەکانت ببینیت و هەرکامیان لە ڕێکخستنەکانی هەژمار بسڕیتەوە؛ سڕینەوەی دانیشتن ئەو ئامێرە لە سیستەم دەردەکات.',
        'ئامێرە متمانەپێکراوەکان: دەتوانیت وێبگەڕێک یان ئامێرێک وەک متمانەپێکراو نیشانە بکەیت تا دووبارەی داواکردنی چوونەژوورەوەی دوو هەنگاو کەم بکەیتەوە. ئەگەر ئامێرە متمانەپێکراوەکە ون بوو یان هاوبەش کرا، لە ڕێکخستنەکانی هەژمار بیسڕەوە.',
      ],
    },
    {
      heading: '٥. پشتبەستن بە WhatsApp و SMS',
      paragraphs: [
        'کاتێک کۆدی پشتڕاستکردنەوە لە ڕێگەی WhatsApp و OTPIQ گەیاندنی پێ دەکرێت، گەیاندن پشت بە لایەنە سێیەمەکان (OTPIQ و Meta)، دابینکەری خزمەتگوزاریی مۆبایلەکەت و بوونی هەژماری چالاکی WhatsApp لەسەر ئامێرەکەت دەبەستێت. ئێمە گەیاندن ضمان ناکەین و بەرپرسیار نین لە هیچ دواکەوتنێک یان شکستێک کە لەلایەن ئەو لایەنانە دروست دەبێت. ئەگەر کۆدێکت وەرنەگرت، کۆدێکی نوێ داوا بکە یان شوێنپێی ئیمەیڵ بەکار بهێنە لەو شوێنانەی بەردەستە.',
        'لەوانەیە کرێی ئاسایی هێڵگری یان نامەکان لە لایەنی WhatsApp ـەوە بکەوێتە سەرت، ئەگەر هەبوون، ئەمە لە نێوان تۆ و دابینکەری مۆبایلتە.',
      ],
    },
    {
      heading: '٦. بەرپرسیارێتی بەڕێوەبەری قوتابخانە',
      paragraphs: [
        'قوتابخانە کۆنترۆڵکارە بۆ هەموو ئەو داتایانەی کە لەسەر پلاتفۆڕم بە ناوی ئەوەوە تۆمار دەکرێت. قوتابخانە بەرپرسیارە لە:',
      ],
      list: [
        'هەڵبژاردنی کام کارمەند کام ڕۆڵی هەیە و ئایا چوونەژوورەوەی دوو هەنگاو فەرز کراوە یان نا.',
        'دڵنیابوون لە دروستی تۆمارەکانی نێو پلاتفۆڕم.',
        'پەیوەندی لەگەڵ دایک و باوکان و کارمەنداندا دەربارەی چۆنیەتی بەکارهێنانی پلاتفۆڕم.',
        'پابەندبوون بە هەر ئەرکێکی کەرتی کە لەسەر قوتابخانە جێبەجێ دەبێت بەپێی یاسای ناوخۆیی.',
        'وەڵامدانەوەی داواکاریەکانی خاوەنی داتا بەپێی ئاگادارکردنەوەی تایبەتمەندیی قوتابخانە، بە یارمەتیمان ئەگەر پێویست بوو.',
      ],
    },
    {
      heading: '٧. بەکارهێنانی پەسەند',
      paragraphs: [
        'تۆ ڕەزامەند دەبیت کە:',
      ],
      list: [
        'خزمەتگوزاری بەکار نەهێنیت بۆ بێزارکردن، هەڕەشەکردن، یان زیانگەیاندن بە هیچ کەسێک.',
        'ناوەڕۆکی نایاسایی، توندوتیژ یان پێشێلکاری مافی کەسانی تر بەرز نەکەیتەوە.',
        'هەوڵ نەدەیت بۆ گەیشتن بە داتای قوتابخانەیەکی تر جگە لە قوتابخانەکەت، یان لاپێچی پشکنینی سنووری قوتابخانە یان ئاسایشی ئاستی ڕیزمان.',
        'بەبێ مۆڵەتی نووسراوی ئێمە، خزمەتگوزاری تاقی نەکەیتەوە یان فحصی نەکەیت.',
        'دەستێوەردان نەکەیت لە کارکردنی خزمەتگوزاری یان لە بەکارهێنانی بەکارهێنەرانی تر.',
        'خزمەتگوزاری بەکار نەهێنیت بۆ ناردنی نامەی بێ داوا.',
        'کۆدی پشتڕاستکردنەوە یان گەڕاندنەوەی تێپەڕەوشە بۆ هەژمارێک داوا نەکەیت کە خاوەنی نیت، یان ئامرازی خۆکار بەکار نەهێنیت بۆ کۆکردنەوەی بودجەکانی پشتڕاستکردنەوە یان سنووری ڕێژە.',
        'دەرگای SMS / WhatsApp بۆ مەبەستی فێڵبازی هەدف نەکەیت (وەک داواکاری کۆدەکان بۆ ئەو ژمارانەی تۆ کۆنترۆڵیان ناکەیت).',
      ],
    },
    {
      heading: '٨. ناوەڕۆکی تۆ',
      paragraphs: [
        'تۆ هەموو مافەکانت دەهێڵیتەوە بۆ ئەو ناوەڕۆکەی کە دەینێریت (نامە، فایل، پۆست). تۆ مۆڵەتێکی سنووردارمان دەدەیتێ بۆ هۆستکردن، گەنجینەکردن، پرۆسێسکردن و پیشاندانی ئەو ناوەڕۆکە تەنها بۆ کارکردنی خزمەتگوزاری بۆ قوتابخانەکەت. نامەکانی کە لە نمایش دەسڕیتەوە لەوانەیە بۆ ماوەیەکی سنووردار بۆ پێداچوونەوەی ئیشراف هەڵبگیرێن پێش پاککردنەوەی کۆتایی؛ ئەمە لە سیاسەتی تایبەتمەندیدا ڕوون کراوەتەوە.',
      ],
    },
    {
      heading: '٩. بەشداری و کرێ',
      paragraphs: [
        'مەرجەکانی بەشداری، نرخ و پارەدان بە جیا لە نێوان Scholify و هەر قوتابخانەیەکدا ڕێک دەخرێن. بەکارهێنەرانی تاکەکەسی (دایک و باوکان، مامۆستایان، کارمەندان، شۆفێرەکان) لەلایەن Scholify ـەوە هیچ کرێیەکیان لەسەر نییە بۆ بەکارهێنانی خزمەتگوزاری.',
      ],
    },
    {
      heading: '١٠. تایبەتمەندی',
      paragraphs: [
        'چۆنیەتی مامەڵەکردنمان لەگەڵ زانیاری کەسی — لەوانە پرۆسێسکارە لاوەکیەکان کە پشتیان پێ دەبەستین، شوێنی هەڵگرتنی داتا، ئەو شتانەی هەڵدەگرین و مافەکانت — لە سیاسەتی تایبەتمەندیدا ڕوون کراوەتەوە. بە بەکارهێنانی خزمەتگوزاری تۆ پەسەندی ئەو سیاسەتە دەکەیت.',
      ],
    },
    {
      heading: '١١. بەردەستبوونی خزمەتگوزاری',
      paragraphs: [
        'ئێمە کار دەکەین بۆ ئەوەی خزمەتگوزاری بە دڵنیاییەوە بەردەوام بێت، بەڵام پێشکەشکردنی بەبێ پچڕان دەستەبەر ناکەین. ڕەنگە چەند کاتژمێرێکی نوێکردنەوەمان هەبێت یان کاتیانە خزمەتگوزاری وەستین بۆ گۆڕانکاری، چارەسەرکردنی کێشە یان چارەسەرکردنی کێشە ئاسایشەکان. هەروەها پشت دەبەستین بە دابینکەرانی لایەنە سێیەم کە پچڕانی خۆیان دەتوانێت کاریگەری لەسەر بەردەستبوون هەبێت.',
      ],
    },
    {
      heading: '١٢. شوێنپێهەڵگرتنی پاس — گرنگ',
      paragraphs: [
        'تایبەتمەندی شوێنپێهەڵگرتنی پاس مەزەندەیەکی باشترینی شوێنی پاس دەخاتە بەردەستەوە بەپێی داتای GPS کە لەلایەن شۆفێرەکانەوە هاوبەش دەکرێت. بەستراوەتەوە بە پەیوەندی مۆبایل، دروستی GPS، ئامێری شۆفێر و کارپێکردنی ئەپ بە ڕاستی لە کاتی گەشتدا. نابێت پشتی پێ ببەسترێت بۆ بڕیارە حەساسەکانی سەلامەتی. هەمیشە ڕێوشوێنی ستانداردی قوتابخانەکەت پەیڕەو بکە بۆ وەرگرتن و چاودێریکردنی قوتابیان.',
      ],
    },
    {
      heading: '١٣. کۆتاییهێنان',
      paragraphs: [
        'قوتابخانە دەتوانێت لە هەر کاتێکدا کۆتایی بە بەکارهێنانی خزمەتگوزاری بهێنێت. هەژمارە تاکەکەسەکان دەکرێت لەلایەن بەڕێوەبەری قوتابخانەوە چالاک نەکرێن یان ئەرشیف بکرێن. ئێمە دەتوانین گەیشتن بوەستێنین یان کۆتایی پێ بهێنین ئەگەر ئەم مەرجانە پێشێل بکرێن، یان مەترسی زیان لەسەر بەکارهێنەرانی تر هەبێت. لە کاتی کۆتاییهێناندا، هێشتنەوەی تۆمارەکان بەپێی سیاسەتی تایبەتمەندی و هەر ڕێککەوتنێک لە نێوان قوتابخانە و Scholify دادەنرێت.',
      ],
    },
    {
      heading: '١٤. ئاگاداری',
      paragraphs: [
        'خزمەتگوزاری "وەکو هەیە" و "بەپێی بەردەستبوون" پێشکەش دەکرێت بەبێ هیچ ضمانێک، نه ڕاستەوخۆ نه ناڕاستەوخۆ، لەوانە ضمانی فرۆشتن، گونجاندن بۆ مەبەستێکی دیاریکراو، دروستی شوێنی پاس یان ئامادەبوون، یان نا-پێشێلکاری، تا ئەو ڕادەی یاسا ڕێگەی پێ دەدات.',
      ],
    },
    {
      heading: '١٥. سنووری بەرپرسیارێتی',
      paragraphs: [
        'تا ئەو ڕادەی یاسا ڕێگەی پێ دەدات، Scholify بەرپرسیار نییە لە هیچ زیانێکی ناڕاستەوخۆ، ڕووداو، تایبەت، یاسایی یان سزایی، یان لە لەدەستچوونی قازانج، داهات، داتا، یان بەکارهێنان کە بەهۆی بەکارهێنانی خزمەتگوزاریتەوە دروست دەبێت، لەوانە هەر شکستێک یان دواکەوتن لە گەیاندنی کۆدی پشتڕاستکردنەوە لە ڕێگەی WhatsApp، SMS یان ئیمەیڵ. بەرپرسیارێتی گشتیمان بۆ هەر سکاڵایەک سەبارەت بە خزمەتگوزاری ناتوانێت زیاتر بێت لە ئەو بڕەی کە قوتابخانەکەت بۆ خزمەتگوزاری لە دوازدە مانگی پێش سکاڵاکەدا داویەتی، یان ١٠٠ دۆلاری ئەمریکی، هەرکامیان زیاترن.',
      ],
    },
    {
      heading: '١٦. قەرەبووکردنەوە',
      paragraphs: [
        'تۆ ڕەزامەند دەبیت Scholify لە هەر سکاڵایەک بپارێزیت کە لە پێشێلکردنی ئەم مەرجانە یان لە بەکارهێنانی نادروستی خزمەتگوزاریتەوە سەرچاوە دەگرێت.',
      ],
    },
    {
      heading: '١٧. یاسای حوکمدار و دادگا',
      paragraphs: [
        'ئەم مەرجانە بە یاساکانی جێبەجێبووی هەرێمی کوردستانی عێراق حوکم دەکرێن. ناکۆکیەکان دەخرێنە بەردەم دادگا پەیوەندیدارەکانی هەولێر. هیچ یەک لەم مەرجانە مافە بێ-وازلێگەراوەکانت لە یاسای ئەو وڵاتەی تێیدا دەژیت سنووردار ناکات.',
      ],
    },
    {
      heading: '١٨. گۆڕانکاریەکان',
      paragraphs: [
        'ڕەنگە ئەم مەرجانە نوێ بکەینەوە لەگەڵ گەشەکردنی خزمەتگوزاری. گۆڕانکاریە گرنگەکان لە ڕێگەی پلاتفۆڕمەوە ڕادەگەیەنرێن. بەردەوامبوون لە بەکارهێنانی خزمەتگوزاری دوای گۆڕانکاری بە پەسەندکردنی مەرجە نوێیەکان دادەنرێت.',
      ],
    },
    {
      heading: '١٩. زمانەکان',
      paragraphs: [
        'ئەم مەرجانە بە ئینگلیزی، عەرەبی و کوردی بڵاو دەکرێنەوە. ئێمە هەوڵی ماقووڵ دەدەین تا وەرگێڕانەکان هاوتەریب بن، بەڵام ئەگەر کێشمەکێشمێکی جدی لە نێوان نوسخەکاندا دروست بوو، نوسخەی ئینگلیزی سەرکەوتوو دەبێت.',
      ],
    },
    {
      heading: '٢٠. پەیوەندی',
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

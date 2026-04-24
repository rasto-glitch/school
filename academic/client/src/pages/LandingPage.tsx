import { Link } from 'react-router-dom';
import {
  BookOpen, FileText, Users, ArrowRight,
  Lightbulb, Library, Sparkles, ChevronRight, PenTool,
  Globe, BookMarked,
} from 'lucide-react';

const FEATURES = [
  {
    icon: FileText,
    color: 'from-indigo-500 to-indigo-600',
    bg: 'bg-indigo-50',
    title: 'Teacher Posts',
    desc: 'Teachers write blog-style articles explaining topics, sharing class notes, and breaking down complex concepts in their own words.',
  },
  {
    icon: Library,
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
    title: 'Digital E-Books',
    desc: "Access your child's textbooks and reading materials digitally. Read directly in the browser — no downloads required.",
  },
  {
    icon: Users,
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50',
    title: 'Class-Specific Content',
    desc: 'All content is tied to a specific class. Parents see content relevant to their child. Teachers manage their own classes.',
  },
];

const STEPS = [
  { step: '01', icon: PenTool, title: 'Teachers write', desc: 'After class, teachers write notes, explanations, or summaries about what was studied — in rich text, plain text, or as a file.' },
  { step: '02', icon: Globe, title: 'Content goes live', desc: 'Once published, posts appear in the feed filtered by class. Drafts stay private until the teacher is ready.' },
  { step: '03', icon: BookOpen, title: 'Parents follow along', desc: "Parents log in and see posts relevant to their child's class — no noise from other classes." },
];

const STATS = [
  { value: 'Rich Text', label: 'Article editor' },
  { value: 'PDF', label: 'E-Book reader' },
  { value: 'Per-class', label: 'Content filtering' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Scholify" className="w-9 h-9 rounded-xl shadow-md shadow-primary-200" />
            <div className="hidden sm:block">
              <span className="font-bold text-gray-900">Academic Portal</span>
              <span className="text-xs text-gray-400 block -mt-0.5">Knowledge Platform</span>
            </div>
          </div>
          <Link
            to="/login"
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-primary-200 hover:shadow-xl hover:shadow-primary-200 active:scale-[0.98] group"
          >
            Sign In
            <ChevronRight className="w-4 h-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary-50/80 via-white to-white" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#4F46E5" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Floating decorative elements */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-indigo-200/20 rounded-full blur-3xl" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 bg-white border border-primary-100 rounded-full px-4 py-1.5 mb-8 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-primary-500" />
            <span className="text-xs font-semibold text-primary-700">Knowledge beyond the classroom</span>
          </div>

          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 max-w-3xl mx-auto leading-[1.1] mb-6">
            Where learning
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-indigo-500">
              never stops
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            A dedicated space where teachers share detailed notes, topic explanations,
            and learning resources — so students and parents can go deeper on anything
            studied in class.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-all shadow-lg shadow-primary-200 hover:shadow-xl active:scale-[0.98] group"
            >
              Sign In to Access
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 font-medium px-6 py-3.5 rounded-xl text-base transition-colors"
            >
              Learn more
              <ChevronRight className="w-4 h-4" />
            </a>
          </div>

          <p className="text-xs text-gray-400 mt-6">Use your school portal credentials to sign in</p>

          {/* Stats bar */}
          <div className="flex items-center justify-center gap-8 sm:gap-12 mt-14">
            {STATS.map(({ value, label }, i) => (
              <div key={label} className="flex items-center gap-8 sm:gap-12">
                {i > 0 && <div className="w-px h-8 bg-gray-200 -ml-8 sm:-ml-12" />}
                <div>
                  <div className="text-xl font-extrabold text-gray-900">{value}</div>
                  <div className="text-xs text-gray-400 font-medium">{label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="px-6 py-24 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
              <Lightbulb className="w-3.5 h-3.5" />
              Platform Features
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">
              What is the Academic Portal?
            </h2>
            <p className="text-gray-500 max-w-xl mx-auto">
              A companion to your school's main portal — focused entirely on academic content.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, color, bg, title, desc }) => (
              <div
                key={title}
                className="group bg-white border border-gray-100 rounded-2xl p-7 shadow-sm hover:shadow-lg hover:border-primary-100 transition-all duration-300"
              >
                <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
                  <div className={`w-8 h-8 bg-gradient-to-br ${color} rounded-lg flex items-center justify-center`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                </div>
                <h3 className="font-bold text-gray-900 mb-2 text-lg">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-gray-50 px-6 py-24">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">How it works</h2>
            <p className="text-gray-500 max-w-lg mx-auto">Three simple steps from classroom to your screen.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(({ step, icon: Icon, title, desc }, i) => (
              <div key={step} className="relative">
                {/* Connector line (hidden on mobile and last item) */}
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-px bg-gradient-to-r from-primary-200 to-transparent" />
                )}
                <div className="flex flex-col items-center text-center">
                  <div className="relative mb-5">
                    <div className="w-16 h-16 bg-white border-2 border-primary-100 rounded-2xl flex items-center justify-center shadow-sm">
                      <Icon className="w-6 h-6 text-primary-600" />
                    </div>
                    <span className="absolute -top-2 -right-2 w-7 h-7 bg-gradient-to-br from-primary-600 to-primary-700 text-white text-xs font-bold rounded-lg flex items-center justify-center shadow-md">
                      {step}
                    </span>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2 text-lg">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-6 py-24">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-700 rounded-3xl px-8 py-16 overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-400/20 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10">
              <BookMarked className="w-10 h-10 text-white/80 mx-auto mb-6" />
              <h2 className="text-3xl font-extrabold text-white mb-3">Ready to get started?</h2>
              <p className="text-primary-200 mb-8 max-w-md mx-auto">
                Sign in with your school portal credentials and start exploring academic content.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 bg-white text-primary-700 font-semibold px-8 py-3.5 rounded-xl transition-all hover:bg-primary-50 shadow-lg active:scale-[0.98] group"
              >
                Sign In
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Scholify" className="w-4 h-4 rounded opacity-60" />
            <span className="text-xs text-gray-400">Academic Portal</span>
          </div>
          <span className="text-xs text-gray-300">Part of your school management system</span>
        </div>
      </footer>
    </div>
  );
}

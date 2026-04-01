import { Link } from 'react-router-dom';
import { BookOpen, FileText, Users, ArrowRight, GraduationCap, Lightbulb, Library } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-gray-900 text-lg">Academic Portal</span>
        </div>
        <Link
          to="/login"
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Sign In <ArrowRight className="w-4 h-4" />
        </Link>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 bg-gradient-to-b from-primary-50 to-white">
        <div className="inline-flex items-center gap-2 bg-primary-100 text-primary-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <Lightbulb className="w-3.5 h-3.5" />
          Knowledge beyond the classroom
        </div>
        <h1 className="text-5xl font-extrabold text-gray-900 max-w-2xl leading-tight mb-4">
          Where learning<br />
          <span className="text-primary-600">never stops</span>
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mb-8 leading-relaxed">
          A dedicated space where teachers share detailed notes, topic explanations,
          and learning resources — so students and parents can go deeper on anything
          studied in class.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold px-6 py-3 rounded-xl text-base transition-colors shadow-lg shadow-primary-200"
        >
          Sign In to Access <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-gray-400 mt-4">Use your school portal credentials to sign in</p>
      </section>

      {/* What is this */}
      <section className="px-6 py-20 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">What is the Academic Portal?</h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">
          A companion to your school's main portal — focused entirely on academic content.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: FileText,
              color: 'bg-indigo-50 text-indigo-600',
              title: 'Teacher Posts',
              desc: 'Teachers write blog-style articles explaining topics, sharing class notes, and breaking down complex concepts in their own words.',
            },
            {
              icon: Library,
              color: 'bg-emerald-50 text-emerald-600',
              title: 'Digital E-Books',
              desc: 'Access your child\'s textbooks and reading materials digitally. Read directly in the browser — no downloads required.',
            },
            {
              icon: Users,
              color: 'bg-violet-50 text-violet-600',
              title: 'Class-Specific',
              desc: 'All content is tied to a specific class. Parents see content relevant to their child. Teachers manage their own classes.',
            },
          ].map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-12">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '1', icon: BookOpen, title: 'Teachers write', desc: 'After class, teachers write notes, explanations, or summaries about what was studied — in plain text, rich text, or as a file.' },
              { step: '2', icon: GraduationCap, title: 'Content goes live', desc: 'Once published, posts appear in the feed filtered by class. Drafts stay private until the teacher is ready.' },
              { step: '3', icon: Users, title: 'Parents & students follow', desc: 'Parents log in and see posts relevant to their child\'s class — no noise from other classes.' },
            ].map(({ step, icon: Icon, title, desc }) => (
              <div key={step} className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-primary-600 text-white rounded-2xl flex items-center justify-center font-bold text-lg mb-4 shadow-lg shadow-primary-200">
                  {step}
                </div>
                <Icon className="w-5 h-5 text-primary-500 mb-2" />
                <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Ready to get started?</h2>
        <p className="text-gray-500 mb-6 text-sm">Sign in with your school portal credentials.</p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors shadow-lg shadow-primary-200"
        >
          Sign In <ArrowRight className="w-4 h-4" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-6 text-center text-xs text-gray-400">
        Academic Portal — part of your school management system
      </footer>
    </div>
  );
}

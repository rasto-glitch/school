import { useState } from 'react';
import PageLayout from '../../components/layout/PageLayout';
import ArchivedStudentsTab from './ArchivedStudentsTab';
import GraduatedStudentsTab from './GraduatedStudentsTab';

export default function ArchiveManagement() {
  const [activeTab, setActiveTab] = useState<'archived' | 'graduated'>('archived');

  return (
    <PageLayout title="Archive">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-6">
        <button
          onClick={() => setActiveTab('archived')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'archived' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Archived
        </button>
        <button
          onClick={() => setActiveTab('graduated')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'graduated' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Graduated
        </button>
      </div>

      {activeTab === 'archived' && <ArchivedStudentsTab />}
      {activeTab === 'graduated' && <GraduatedStudentsTab />}
    </PageLayout>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Send } from 'lucide-react';
import { adminApi } from '../../services/api';
import PageLayout from '../../components/layout/PageLayout';
import Card from '../../components/common/Card';
import Select from '../../components/common/Select';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import { toast } from 'react-toastify';

export default function AdminNotificationsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'recent' | 'all'>('recent');
  const [sending, setSending] = useState(false);

  // Send notification state
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetRole, setTargetRole] = useState('all');


  const sendNotification = async () => {
    if (!title || !message) { toast.error(t('admin.title_message_required')); return; }
    setSending(true);
    try {
      // Get all users of target role and send notification to each
      // For simplicity, we call a broadcast endpoint
      await adminApi.sendNotification({ title, message, type: 'general', targetRole });
      toast.success(t('admin.notif_sent'));
      setTitle('');
      setMessage('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('admin.notif_send_failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <PageLayout title={t('nav.notifications')} subtitle={t('admin.notif_subtitle')}>
      <div className="space-y-6 max-w-2xl">
        {/* Send notification */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Send className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">{t('admin.send_notification')}</h2>
          </div>
          <div className="space-y-4">
            <Select
              label={t('admin.send_to')}
              value={targetRole}
              onChange={e => setTargetRole(e.target.value)}
              options={[
                { value: 'all', label: t('admin.everyone') },
                { value: 'parent', label: t('admin.all_parents') },
                { value: 'teacher', label: t('admin.all_teachers') },
                { value: 'driver', label: t('admin.all_drivers') },
              ]}
            />
            <Input
              label={t('admin.title_label')}
              placeholder={t('admin.notif_title_ph')}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin.message')}</label>
              <textarea
                className="input-field min-h-[100px] resize-none"
                placeholder={t('admin.notif_message_ph')}
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>
            <Button onClick={sendNotification} loading={sending} fullWidth icon={<Send className="w-4 h-4" />}>
              {t('admin.send_notification')}
            </Button>
          </div>
        </Card>

        {/* Filter + recent notifications */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">{t('admin.recent')}</h2>
            <div className="w-36">
              <Select
                options={[
                  { value: 'recent', label: t('admin.filter_recent') },
                  { value: 'all', label: t('admin.filter_all') },
                ]}
                value={filter}
                onChange={e => setFilter(e.target.value as 'recent' | 'all')}
              />
            </div>
          </div>

          <Card>
              <EmptyState
                title={t('admin.notif_empty_title')}
                description={t('admin.notif_empty_desc')}
                icon={<Bell className="w-8 h-8 text-gray-400" />}
              />
            </Card>
        </div>
      </div>
    </PageLayout>
  );
}

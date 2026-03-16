import { useState } from 'react';
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
  const [filter, setFilter] = useState<'recent' | 'all'>('recent');
  const [sending, setSending] = useState(false);

  // Send notification state
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetRole, setTargetRole] = useState('all');


  const sendNotification = async () => {
    if (!title || !message) { toast.error('Title and message are required'); return; }
    setSending(true);
    try {
      // Get all users of target role and send notification to each
      // For simplicity, we call a broadcast endpoint
      await adminApi.sendNotification({ title, message, type: 'general', targetRole });
      toast.success('Notification sent!');
      setTitle('');
      setMessage('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send notification');
    } finally {
      setSending(false);
    }
  };

  return (
    <PageLayout title="Notifications" subtitle="Send and manage school notifications">
      <div className="space-y-6 max-w-2xl">
        {/* Send notification */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Send className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Send Notification</h2>
          </div>
          <div className="space-y-4">
            <Select
              label="Send To"
              value={targetRole}
              onChange={e => setTargetRole(e.target.value)}
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'parent', label: 'All Parents' },
                { value: 'teacher', label: 'All Teachers' },
                { value: 'driver', label: 'All Drivers' },
              ]}
            />
            <Input
              label="Title"
              placeholder="Notification title"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Message</label>
              <textarea
                className="input-field min-h-[100px] resize-none"
                placeholder="Write your notification message..."
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>
            <Button onClick={sendNotification} loading={sending} fullWidth icon={<Send className="w-4 h-4" />}>
              Send Notification
            </Button>
          </div>
        </Card>

        {/* Filter + recent notifications */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Recent:</h2>
            <div className="w-36">
              <Select
                options={[
                  { value: 'recent', label: 'Recent' },
                  { value: 'all', label: 'All' },
                ]}
                value={filter}
                onChange={e => setFilter(e.target.value as 'recent' | 'all')}
              />
            </div>
          </div>

          <Card>
              <EmptyState
                title="Notifications will appear here"
                description="Notifications sent to users will be listed here once you start sending them."
                icon={<Bell className="w-8 h-8 text-gray-400" />}
              />
            </Card>
        </div>
      </div>
    </PageLayout>
  );
}

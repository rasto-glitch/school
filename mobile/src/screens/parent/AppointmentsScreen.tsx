import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, TextInput, Alert, Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar, Plus, X, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { parentApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { useBadgeStore } from '../../store/badgeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface Appointment {
  id: string;
  reason: string;
  message?: string;
  requestedDate?: string;
  status: string;
  adminNote?: string;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
};

const STATUS_ICON: Record<string, any> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
};

export default function AppointmentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [calViewDate, setCalViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  const clearBooking = useBadgeStore(s => s.clearBooking);

  const load = () => parentApi.getAppointments().then(r => setItems(r.data || []));
  useEffect(() => {
    clearBooking();
    parentApi.markTypeRead('appointment').catch(() => {});
    load().finally(() => setLoading(false));
  }, []);
  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const handleSubmit = async () => {
    if (!reason.trim()) {
      Alert.alert(t('common.save'), t('appointments.reason'));
      return;
    }
    setSubmitting(true);
    try {
      await parentApi.createAppointment({ reason: reason.trim(), message: message.trim() || undefined, requestedDate: requestedDate || undefined });
      setReason(''); setMessage(''); setRequestedDate(''); setShowCalendar(false);
      setShowModal(false);
      load();
      Alert.alert('✓', t('appointments.toast_success'));
    } catch {
      Alert.alert('Error', t('appointments.toast_error'));
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel: Record<string, string> = {
    pending: t('appointments.status_pending'),
    approved: t('appointments.status_approved'),
    rejected: t('appointments.status_rejected'),
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Calendar size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('appointments.no_appointments')}</Text>
            <Text style={styles.emptySub}>{t('appointments.subtitle')}</Text>
          </View>
        ) : (
          items.map(item => {
            const StatusIcon = STATUS_ICON[item.status] ?? Clock;
            const color = STATUS_COLOR[item.status] ?? colors.textMuted;
            const expanded = expandedId === item.id;
            return (
              <TouchableOpacity key={item.id} style={styles.card} onPress={() => toggle(item.id)} activeOpacity={0.8}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reason}>{item.reason}</Text>
                    {item.requestedDate && (
                      <Text style={styles.date}>{t('appointments.requested')}: {new Date(item.requestedDate).toLocaleDateString()}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
                      <StatusIcon size={13} color={color} />
                      <Text style={[styles.statusText, { color }]}>{statusLabel[item.status] ?? item.status}</Text>
                    </View>
                    {expanded ? <ChevronUp size={14} color={colors.textMuted} /> : <ChevronDown size={14} color={colors.textMuted} />}
                  </View>
                </View>

                {expanded && (
                  <View style={styles.expandedBody}>
                    {item.message && <Text style={styles.messageText}>{item.message}</Text>}
                    {item.adminNote && (
                      <View style={styles.noteBox}>
                        <Text style={styles.noteLabel}>{t('appointments.school_response')}</Text>
                        <Text style={styles.noteText}>{item.adminNote}</Text>
                      </View>
                    )}
                    <Text style={styles.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={() => setShowModal(true)}>
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('appointments.new_request')}</Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <X size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>{t('appointments.reason')} *</Text>
          <TextInput
            style={styles.input}
            placeholder={t('appointments.reason_placeholder')}
            placeholderTextColor={colors.textMuted}
            value={reason}
            onChangeText={setReason}
          />

          <Text style={styles.fieldLabel}>{t('appointments.message')}</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder={t('appointments.message_placeholder')}
            placeholderTextColor={colors.textMuted}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.fieldLabel}>{t('appointments.preferred_date')}</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowCalendar(v => !v)} activeOpacity={0.7}>
            <Calendar size={16} color={requestedDate ? colors.primary : colors.textMuted} />
            <Text style={[styles.dateBtnText, requestedDate ? { color: colors.primary, fontWeight: '600' } : { color: colors.textMuted }]}>
              {requestedDate
                ? new Date(requestedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })
                : 'Select a date'}
            </Text>
            {requestedDate ? (
              <TouchableOpacity onPress={() => { setRequestedDate(''); setShowCalendar(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ) : (
              <ChevronDown size={14} color={colors.textMuted} />
            )}
          </TouchableOpacity>

          {showCalendar && (() => {
            const year = calViewDate.getFullYear();
            const month = calViewDate.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const prevMonth = () => setCalViewDate(new Date(year, month - 1, 1));
            const nextMonth = () => setCalViewDate(new Date(year, month + 1, 1));
            const monthLabel = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
            while (cells.length % 7 !== 0) cells.push(null);
            return (
              <View style={styles.calendar}>
                <View style={styles.calHeader}>
                  <TouchableOpacity onPress={prevMonth} style={styles.calNav}><ChevronLeft size={16} color={colors.text} /></TouchableOpacity>
                  <Text style={styles.calMonth}>{monthLabel}</Text>
                  <TouchableOpacity onPress={nextMonth} style={styles.calNav}><ChevronRight size={16} color={colors.text} /></TouchableOpacity>
                </View>
                <View style={styles.calDayRow}>
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                    <Text key={d} style={styles.calDayLabel}>{d}</Text>
                  ))}
                </View>
                {Array.from({ length: cells.length / 7 }, (_, row) => (
                  <View key={row} style={styles.calWeekRow}>
                    {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                      if (!day) return <View key={col} style={styles.calCell} />;
                      const thisDate = new Date(year, month, day);
                      const isPast = thisDate < today;
                      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const selected = requestedDate === iso;
                      return (
                        <TouchableOpacity
                          key={col}
                          style={[styles.calCell, selected && styles.calCellSelected, isPast && styles.calCellPast]}
                          onPress={() => { if (!isPast) { setRequestedDate(iso); setShowCalendar(false); } }}
                          disabled={isPast}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.calDayNum, selected && styles.calDayNumSelected, isPast && styles.calDayNumPast]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            );
          })()}

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.submitText}>{submitting ? t('common.loading') : t('appointments.submit')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  content: { padding: spacing.md },
  empty: { alignItems: 'center', marginTop: 80, gap: spacing.sm },
  emptyText: { fontSize: font.md, fontWeight: '600', color: colors.textMuted },
  emptySub: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 32 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reason: { fontSize: font.md, fontWeight: '700', color: colors.text },
  date: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: font.xs, fontWeight: '700' },
  expandedBody: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  messageText: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  noteBox: { backgroundColor: colors.bg, borderRadius: radius.sm, padding: spacing.sm, marginBottom: spacing.sm },
  noteLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  noteText: { fontSize: font.sm, color: colors.text },
  createdAt: { fontSize: font.xs, color: colors.textMuted },
  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    ...shadow.md,
  },
  modal: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  textarea: { height: 100, textAlignVertical: 'top' },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  submitText: { fontSize: font.md, fontWeight: '700', color: '#fff' },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  dateBtnText: { flex: 1, fontSize: font.md, color: colors.textMuted },
  calendar: {
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginTop: spacing.xs,
  },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  calNav: { padding: 6 },
  calMonth: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  calDayRow: { flexDirection: 'row', marginBottom: 4 },
  calDayLabel: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  calWeekRow: { flexDirection: 'row' },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  calCellSelected: { backgroundColor: colors.primary },
  calCellPast: { opacity: 0.3 },
  calDayNum: { fontSize: font.sm, color: colors.text },
  calDayNumSelected: { color: '#fff', fontWeight: '700' },
  calDayNumPast: { color: colors.textMuted },
});

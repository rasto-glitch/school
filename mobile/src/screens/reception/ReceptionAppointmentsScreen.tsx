import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  TextInput, Alert, Keyboard, ActivityIndicator,
} from 'react-native';
import { CardListSkeleton } from '../../components/Skeleton';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Calendar, Clock, CheckCircle, XCircle, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { receptionApi } from '../../services/api';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';

interface Appointment {
  id: string;
  status: string;
  reason?: string;
  message?: string;
  requestedDate?: string;
  scheduledDate?: string;
  responseMessage?: string;
  createdAt: string;
  inviteReason?: string;
  invitedByName?: string;
  assignedAdminName?: string;
  parents?: { fullName?: string; full_name?: string };
}

interface AdminOption { id: string; fullName: string }

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
  invited: '#6366F1',
};
const STATUS_ICON: Record<string, any> = { pending: Clock, approved: CheckCircle, rejected: XCircle, invited: Clock };

// Reception is the sole confirmer (Phase D). On approval it assigns the admin
// who'll take the meeting and may reschedule. Mirrors the web AppointmentsPage.
export default function ReceptionAppointmentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<Appointment[]>([]);
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);

  // Per-row draft state (admin / date / message), keyed by appointment id.
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [calendarFor, setCalendarFor] = useState<string | null>(null);
  const [calViewDate, setCalViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const load = useCallback(() => receptionApi.getAppointments().then(r => setItems(r.data || [])), []);

  useEffect(() => {
    receptionApi.getAssignableAdmins().then(r => setAdmins(r.data || [])).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  const respond = async (apt: Appointment, status: 'approved' | 'rejected') => {
    const assignedAdminId = assign[apt.id] || '';
    if (status === 'approved' && !assignedAdminId) { Alert.alert(t('reception.assign_required')); return; }
    setResponding(apt.id);
    try {
      await receptionApi.respondToAppointment(apt.id, {
        responseMessage: messages[apt.id] || '',
        scheduledDate: dates[apt.id] || apt.scheduledDate || apt.requestedDate || '',
        status,
        assignedAdminId: status === 'approved' ? assignedAdminId : null,
      });
      Alert.alert('✓', status === 'approved' ? t('reception.toast_approved') : t('reception.toast_rejected'));
      await load();
    } catch {
      Alert.alert(t('common.error'), t('reception.respond_failed'));
    } finally {
      setResponding(null);
    }
  };

  const statusLabel: Record<string, string> = {
    pending: t('appointments.status_pending'),
    approved: t('appointments.status_approved'),
    rejected: t('appointments.status_rejected'),
    invited: t('appointments.status_invited'),
  };

  const fmtDate = (iso?: string) => iso ? new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString() : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {loading ? (
          <CardListSkeleton count={3} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Calendar size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('reception.no_appointments')}</Text>
          </View>
        ) : (
          items.map(apt => {
            const StatusIcon = STATUS_ICON[apt.status] ?? Clock;
            const color = STATUS_COLOR[apt.status] ?? colors.textMuted;
            const parentName = apt.parents?.fullName || apt.parents?.full_name || t('reception.parent_fallback');
            const isPending = apt.status === 'pending';
            const selectedDate = dates[apt.id] ?? (apt.scheduledDate || apt.requestedDate || '');
            return (
              <View key={apt.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.parentName}>{parentName}</Text>
                    {apt.reason ? <Text style={styles.reason}>{t('appointments.reason')}: {apt.reason}</Text> : null}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: color + '20' }]}>
                    <StatusIcon size={13} color={color} />
                    <Text style={[styles.statusText, { color }]}>{statusLabel[apt.status] ?? apt.status}</Text>
                  </View>
                </View>

                {apt.message ? <Text style={styles.message}>{apt.message}</Text> : null}
                {apt.inviteReason ? (
                  <View style={styles.inviteBox}>
                    <Text style={styles.inviteFrom}>{t('reception.invite_from', { name: apt.invitedByName || t('reception.a_supervisor') })}</Text>
                    <Text style={styles.inviteReason}>{apt.inviteReason}</Text>
                  </View>
                ) : null}
                {apt.requestedDate ? <Text style={styles.meta}>{t('reception.parent_requested', { date: fmtDate(apt.requestedDate) })}</Text> : null}
                <Text style={styles.meta}>{t('reception.submitted', { date: fmtDate(apt.createdAt) })}</Text>

                {isPending ? (
                  <View style={styles.actionArea}>
                    {/* Assign admin */}
                    <Text style={styles.fieldLabel}>{t('reception.assign_admin')}</Text>
                    {admins.length === 0 ? (
                      <Text style={styles.noAdmins}>{t('reception.no_admins')}</Text>
                    ) : (
                      <View style={styles.chipRow}>
                        {admins.map(a => {
                          const sel = assign[apt.id] === a.id;
                          return (
                            <TouchableOpacity
                              key={a.id}
                              style={[styles.chip, sel && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                              onPress={() => setAssign(s => ({ ...s, [apt.id]: sel ? '' : a.id }))}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.chipText, sel && { color: '#fff' }]}>{a.fullName}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    {/* Schedule date */}
                    <Text style={styles.fieldLabel}>{t('reception.schedule_date')}</Text>
                    <TouchableOpacity
                      style={styles.dateBtn}
                      onPress={() => { Keyboard.dismiss(); setCalendarFor(prev => prev === apt.id ? null : apt.id); }}
                      activeOpacity={0.7}
                    >
                      <Calendar size={16} color={selectedDate ? colors.primary : colors.textMuted} />
                      <Text style={[styles.dateBtnText, selectedDate ? { color: colors.primary, fontWeight: '600' } : { color: colors.textMuted }]}>
                        {selectedDate ? fmtDate(selectedDate) : t('reception.pick_date')}
                      </Text>
                      {selectedDate ? (
                        <TouchableOpacity onPress={() => setDates(s => ({ ...s, [apt.id]: '' }))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <X size={14} color={colors.textMuted} />
                        </TouchableOpacity>
                      ) : (
                        <ChevronDown size={14} color={colors.textMuted} />
                      )}
                    </TouchableOpacity>

                    {calendarFor === apt.id && (() => {
                      const year = calViewDate.getFullYear();
                      const month = calViewDate.getMonth();
                      const firstDay = new Date(year, month, 1).getDay();
                      const daysInMonth = new Date(year, month + 1, 0).getDate();
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const monthLabel = calViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                      const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
                      while (cells.length % 7 !== 0) cells.push(null);
                      return (
                        <View style={styles.calendar}>
                          <View style={styles.calHeader}>
                            <TouchableOpacity onPress={() => setCalViewDate(new Date(year, month - 1, 1))} style={styles.calNav}><ChevronLeft size={16} color={colors.text} /></TouchableOpacity>
                            <Text style={styles.calMonth}>{monthLabel}</Text>
                            <TouchableOpacity onPress={() => setCalViewDate(new Date(year, month + 1, 1))} style={styles.calNav}><ChevronRight size={16} color={colors.text} /></TouchableOpacity>
                          </View>
                          <View style={styles.calDayRow}>
                            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <Text key={d} style={styles.calDayLabel}>{d}</Text>)}
                          </View>
                          {Array.from({ length: cells.length / 7 }, (_, row) => (
                            <View key={row} style={styles.calWeekRow}>
                              {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                                if (!day) return <View key={col} style={styles.calCell} />;
                                const thisDate = new Date(year, month, day);
                                const isPast = thisDate < today;
                                const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                const sel = selectedDate === iso;
                                return (
                                  <TouchableOpacity
                                    key={col}
                                    style={[styles.calCell, sel && styles.calCellSelected, isPast && styles.calCellPast]}
                                    onPress={() => { if (!isPast) { setDates(s => ({ ...s, [apt.id]: iso })); setCalendarFor(null); } }}
                                    disabled={isPast}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={[styles.calDayNum, sel && styles.calDayNumSelected, isPast && styles.calDayNumPast]}>{day}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      );
                    })()}

                    {/* Response message */}
                    <Text style={styles.fieldLabel}>{t('reception.response_label_short')}</Text>
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      placeholder={t('reception.response_ph')}
                      placeholderTextColor={colors.textMuted}
                      value={messages[apt.id] || ''}
                      onChangeText={v => setMessages(s => ({ ...s, [apt.id]: v }))}
                      multiline
                    />

                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#10B981' }]}
                        onPress={() => respond(apt, 'approved')}
                        disabled={responding === apt.id}
                        activeOpacity={0.85}
                      >
                        {responding === apt.id ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle size={16} color="#fff" />}
                        <Text style={styles.actionBtnText}>{t('reception.approve')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#EF4444' }]}
                        onPress={() => respond(apt, 'rejected')}
                        disabled={responding === apt.id}
                        activeOpacity={0.85}
                      >
                        <XCircle size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>{t('reception.reject')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (apt.responseMessage || apt.scheduledDate || apt.assignedAdminName) ? (
                  <View style={styles.summaryBox}>
                    {apt.responseMessage ? <Text style={styles.summaryText}>{t('reception.response_label')} {apt.responseMessage}</Text> : null}
                    {apt.scheduledDate ? <Text style={styles.summaryText}>{t('appointments.scheduled')}: {fmtDate(apt.scheduledDate)}</Text> : null}
                    {apt.assignedAdminName ? <Text style={styles.summaryText}>{t('reception.assigned_to', { name: apt.assignedAdminName })}</Text> : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof import('../../store/themeStore').useColors>) => StyleSheet.create({
  content: { padding: spacing.md },
  empty: { alignItems: 'center', marginTop: 80, gap: spacing.sm },
  emptyText: { fontSize: font.md, fontWeight: '600', color: colors.textMuted },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  parentName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  reason: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  message: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.sm, padding: spacing.sm },
  inviteBox: { backgroundColor: colors.primaryLight, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  inviteFrom: { fontSize: font.xs, fontWeight: '700', color: colors.primary },
  inviteReason: { fontSize: font.sm, color: colors.text, marginTop: 2 },
  meta: { fontSize: font.xs, color: colors.textMuted, marginTop: 4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: font.xs, fontWeight: '700' },
  actionArea: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  noAdmins: { fontSize: font.sm, color: colors.textMuted, fontStyle: 'italic' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.bg },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.bg, borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  dateBtnText: { flex: 1, fontSize: font.md },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  textarea: { height: 80, textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.md, paddingVertical: 12 },
  actionBtnText: { color: '#fff', fontSize: font.sm, fontWeight: '700' },
  summaryBox: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  summaryText: { fontSize: font.xs, color: colors.textMuted },
  calendar: {
    backgroundColor: colors.bg, borderRadius: radius.md,
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

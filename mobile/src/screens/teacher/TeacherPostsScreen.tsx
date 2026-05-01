import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, Image, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, Send, Trash2, Image as ImageIcon, FileText } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardListSkeleton } from '../../components/Skeleton';
import { academicApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useColors } from '../../store/themeStore';
import { spacing, radius, font, shadow } from '../../theme';
import type { AcademicPost } from '../../types';

interface ClassItem { id: string; name: string }
interface Props { subject?: string; classes: ClassItem[] }

export default function TeacherPostsScreen({ subject, classes }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const navigation = useNavigation<any>();
  const { user } = useAuthStore();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [posts, setPosts] = useState<AcademicPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [classId, setClassId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isPublished, setIsPublished] = useState(true);

  const load = useCallback(() => {
    academicApi.getPosts()
      .then(r => {
        const all: AcademicPost[] = r.data || [];
        // Show only this teacher's own posts here
        setPosts(all.filter(p => p.author_user_id === user?.id));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (classes.length > 0 && !classId) setClassId(classes[0].id);
  }, [classes]);

  const resetForm = () => {
    setTitle(''); setBody(''); setImage(null); setIsPublished(true);
    if (classes[0]) setClassId(classes[0].id);
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow photo access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setImage({
        uri: asset.uri,
        name: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });
    }
  };

  const handleSubmit = async () => {
    if (!classId || !title.trim()) {
      Alert.alert('Required', 'Please select a class and enter a title.');
      return;
    }
    setSubmitting(true);
    try {
      let imageUrl: string | undefined;
      if (image) {
        setUploadingImage(true);
        try {
          const up = await academicApi.uploadPostFile(image);
          imageUrl = up.data?.url;
        } finally { setUploadingImage(false); }
      }
      await academicApi.createPost({
        title: title.trim(),
        classId,
        contentType: 'plaintext',
        body: body.trim() || undefined,
        subject: subject || undefined,
        imageUrl,
        isPublished,
      });
      resetForm();
      setShowForm(false);
      load();
    } catch {
      Alert.alert('Error', 'Could not create post.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (post: AcademicPost) => {
    Alert.alert('Delete post', `Delete "${post.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await academicApi.deletePost(post.id);
            setPosts(prev => prev.filter(p => p.id !== post.id));
          } catch { Alert.alert('Error', 'Could not delete post.'); }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}>
        {loading ? (
          <CardListSkeleton count={3} />
        ) : posts.length === 0 ? (
          <View style={styles.empty}>
            <FileText size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>No posts yet. Tap + to write one.</Text>
          </View>
        ) : (
          posts.map(p => (
            <TouchableOpacity
              key={p.id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('PostDetail', { postId: p.id })}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.cardMetaRow}>
                  {p.classes?.name && (
                    <View style={[styles.tag, { backgroundColor: colors.bg }]}>
                      <Text style={[styles.tagText, { color: colors.textMuted }]}>{p.classes.name}</Text>
                    </View>
                  )}
                  {!p.is_published && (
                    <View style={[styles.tag, { backgroundColor: '#FEF3C7' }]}>
                      <Text style={[styles.tagText, { color: '#92400E' }]}>Draft</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{p.title}</Text>
                {p.body && <Text style={styles.cardBody} numberOfLines={2}>{p.body}</Text>}
                <Text style={styles.cardDate}>{new Date(p.created_at).toLocaleDateString()}</Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={8} style={{ paddingLeft: 8 }}>
                <Trash2 size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Floating + button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 16 }]}
        onPress={() => setShowForm(true)}
        activeOpacity={0.8}
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      {/* Composer modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <View style={[styles.modal, { backgroundColor: colors.bg, paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}>
              <X size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>New post</Text>
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting || uploadingImage || !title.trim() || !classId}
              style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: (submitting || uploadingImage || !title.trim() || !classId) ? 0.5 : 1 }]}
            >
              {submitting || uploadingImage
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Send size={14} color="#fff" /><Text style={styles.submitBtnText}>{isPublished ? 'Publish' : 'Save'}</Text></>}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Class</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: spacing.sm }}>
              {classes.map(c => {
                const active = c.id === classId;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setClassId(c.id)}
                    style={[
                      styles.chip,
                      { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryLight : colors.card },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primary : colors.text }]}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.label, { color: colors.textMuted }]}>Title</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={title}
              onChangeText={setTitle}
              placeholder="Post title"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={[styles.label, { color: colors.textMuted }]}>Body</Text>
            <TextInput
              style={[styles.textarea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
              value={body}
              onChangeText={setBody}
              placeholder="Write something..."
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <Text style={[styles.label, { color: colors.textMuted }]}>Image (optional)</Text>
            {image ? (
              <View style={styles.imagePreview}>
                <Image source={{ uri: image.uri }} style={styles.imagePreviewImg} />
                <TouchableOpacity
                  onPress={() => setImage(null)}
                  style={[styles.imageRemoveBtn, { backgroundColor: colors.card }]}
                >
                  <X size={14} color={colors.text} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={pickImage}
                style={[styles.imagePickBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <ImageIcon size={20} color={colors.textMuted} />
                <Text style={[styles.imagePickText, { color: colors.textMuted }]}>Pick an image</Text>
              </TouchableOpacity>
            )}

            <View style={[styles.publishRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.publishLabel, { color: colors.text }]}>Publish now</Text>
                <Text style={[styles.publishHelp, { color: colors.textMuted }]}>
                  Off saves as a draft you can publish later.
                </Text>
              </View>
              <Switch
                value={isPublished}
                onValueChange={setIsPublished}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  list: { padding: spacing.md, gap: spacing.sm },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.md },
  emptyText: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },

  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.sm,
  },
  cardMetaRow: { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  tagText: { fontSize: 10, fontWeight: '700' },
  cardTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: 4 },
  cardBody: { fontSize: font.sm, color: colors.textSecondary, marginBottom: 6 },
  cardDate: { fontSize: font.xs, color: colors.textMuted },

  fab: {
    position: 'absolute',
    right: 16,
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    ...shadow.md,
  },

  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, gap: spacing.sm,
  },
  modalTitle: { flex: 1, fontSize: font.lg, fontWeight: '700', textAlign: 'center' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md,
  },
  submitBtnText: { color: '#fff', fontSize: font.sm, fontWeight: '700' },

  label: { fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: font.sm,
  },
  textarea: {
    borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: font.sm,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1.5 },
  chipText: { fontSize: font.xs, fontWeight: '700' },

  imagePickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed',
  },
  imagePickText: { fontSize: font.sm, fontWeight: '600' },
  imagePreview: { position: 'relative' },
  imagePreviewImg: { width: '100%', height: 180, borderRadius: radius.md },
  imageRemoveBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    ...shadow.sm,
  },

  publishRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1,
  },
  publishLabel: { fontSize: font.sm, fontWeight: '700', marginBottom: 2 },
  publishHelp: { fontSize: font.xs },
});

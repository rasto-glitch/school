import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useColors } from '../store/themeStore';
import { spacing, radius } from '../theme';

/* ─── Base shimmer block ─── */
function SkeletonBox({ width, height, borderRadius = radius.sm, style }: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: object;
}) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: colors.border, opacity },
        style,
      ]}
    />
  );
}

/* ─── Presets ─── */

/** Single card skeleton: icon box + 2-3 text lines */
export function CardSkeleton({ hasIcon = true }: { hasIcon?: boolean }) {
  const colors = useColors();
  return (
    <View style={[s.card, { backgroundColor: colors.card }]}>
      <View style={s.cardRow}>
        {hasIcon && <SkeletonBox width={36} height={36} borderRadius={radius.sm} />}
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBox width="70%" height={14} />
          <SkeletonBox width="50%" height={11} />
          <SkeletonBox width="40%" height={10} />
        </View>
      </View>
    </View>
  );
}

/** Multiple card skeletons */
export function CardListSkeleton({ count = 4, hasIcon = true }: { count?: number; hasIcon?: boolean }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} hasIcon={hasIcon} />
      ))}
    </View>
  );
}

/** Hero card (tall) + smaller cards below */
export function HeroListSkeleton({ count = 3 }: { count?: number }) {
  const colors = useColors();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[s.hero, { backgroundColor: colors.primary + '20' }]}>
        <SkeletonBox width="40%" height={12} />
        <SkeletonBox width="80%" height={18} style={{ marginTop: 12 }} />
        <SkeletonBox width="100%" height={12} style={{ marginTop: 10 }} />
        <SkeletonBox width="60%" height={12} style={{ marginTop: 6 }} />
        <SkeletonBox width="30%" height={10} style={{ marginTop: 12 }} />
      </View>
      <CardListSkeleton count={count} />
    </View>
  );
}

/** Dashboard skeleton: greeting + action grid + card list */
export function DashboardSkeleton() {
  const colors = useColors();
  return (
    <View style={{ gap: spacing.md }}>
      {/* Greeting area */}
      <View style={{ gap: 6 }}>
        <SkeletonBox width="50%" height={22} borderRadius={radius.sm} />
        <SkeletonBox width="35%" height={12} />
      </View>
      {/* Action grid */}
      <View style={s.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[s.gridItem, { backgroundColor: colors.card }]}>
            <SkeletonBox width={44} height={44} borderRadius={radius.sm} />
            <SkeletonBox width="70%" height={11} />
          </View>
        ))}
      </View>
      {/* Recent items */}
      <SkeletonBox width="30%" height={11} />
      <CardListSkeleton count={3} />
    </View>
  );
}

/** Profile / Me screen skeleton */
export function ProfileSkeleton() {
  const colors = useColors();
  return (
    <View style={{ gap: spacing.md, alignItems: 'center' }}>
      <SkeletonBox width={80} height={80} borderRadius={40} />
      <SkeletonBox width="50%" height={18} />
      <SkeletonBox width="30%" height={12} />
      <View style={[s.card, { backgroundColor: colors.card, width: '100%', marginTop: spacing.sm }]}>
        <View style={{ gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <SkeletonBox width="35%" height={13} />
              <SkeletonBox width="45%" height={13} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Chat list skeleton */
export function ChatListSkeleton({ count = 5 }: { count?: number }) {
  const colors = useColors();
  return (
    <View style={{ gap: 2 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[s.chatRow, { backgroundColor: colors.card }]}>
          <SkeletonBox width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBox width="60%" height={14} />
            <SkeletonBox width="80%" height={11} />
          </View>
          <SkeletonBox width={40} height={10} />
        </View>
      ))}
    </View>
  );
}

/** Grid of cards (for grades, students) */
export function GridSkeleton({ count = 6, columns = 2 }: { count?: number; columns?: number }) {
  const colors = useColors();
  return (
    <View style={[s.grid, { gap: spacing.sm }]}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[s.gridItem, { backgroundColor: colors.card, minHeight: 90 }]}>
          <SkeletonBox width="60%" height={14} />
          <SkeletonBox width="80%" height={11} style={{ marginTop: 8 }} />
          <SkeletonBox width="40%" height={10} style={{ marginTop: 6 }} />
        </View>
      ))}
    </View>
  );
}

/** Simple list rows (no icon box) */
export function RowListSkeleton({ count = 5 }: { count?: number }) {
  const colors = useColors();
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[s.card, { backgroundColor: colors.card }]}>
          <View style={{ gap: 8 }}>
            <SkeletonBox width="65%" height={14} />
            <SkeletonBox width="45%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  hero: {
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItem: {
    width: '30%',
    flexGrow: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
});

export default SkeletonBox;

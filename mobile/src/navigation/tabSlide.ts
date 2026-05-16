import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

/**
 * Facebook-style directional tab slide for `createBottomTabNavigator` (v7).
 *
 * The library drives `current.progress` to -1 / 0 / +1 depending on whether a
 * screen sits left of, on, or right of the focused tab (BottomTabView.js:101),
 * and runs the transition on the native driver on iOS/Android — so a pure
 * `translateX` interpolation slides the whole screen in the tab-order
 * direction without dropping to the JS thread (this is the "not janky" part).
 *
 * Motion model is a SPRING, not a timing curve. Two reasons it reads smoother
 * and "lands" the way Facebook's does:
 *   1. Soft physical settle instead of a curve hitting t=1 and stopping.
 *   2. Interruption: tapping mid-transition continues from the current
 *      velocity instead of restarting cold (timing curves jump velocity on
 *      every tap — that was the not-smooth feel during fast switching).
 * A spring is only safe here because `detachInactiveScreens={false}` on the
 * navigators removed the screen-detach logic that an overshoot used to race;
 * overshoot is now visually harmless.
 *
 * No opacity fade: Facebook's horizontal tab slide is a clean wipe, and the
 * outgoing/incoming screens occupy disjoint halves mid-transition, so they
 * read as one rigid pair moving together rather than a cross-fade.
 *
 * `width` should be the live window width (rotation-safe) from the caller's
 * `useWindowDimensions()`.
 */
type SlideTransition = Pick<BottomTabNavigationOptions, 'transitionSpec' | 'sceneStyleInterpolator'>;

export function makeSlideTransition(width: number): SlideTransition {
  return {
    transitionSpec: {
      animation: 'spring',
      config: {
        // Snappiness = stiffness (kept high at 480). Smoothness of the
        // glide/landing = damping RATIO: ζ ≈ 0.84 here (critical damping for
        // stiffness 480, mass 1 is 2·√480 ≈ 43.8; 37/43.8 ≈ 0.84). Slightly
        // underdamped lands silkier than ζ≈1 (which stops a touch abruptly);
        // overshoot at ζ0.84 is <1% — invisible, no bounce.
        // Dial: smoother settle → lower damping (34 ≈ ζ0.78, 30 ≈ ζ0.68);
        //       firmer/crisper landing → raise damping toward 44 (ζ≈1);
        //       more/less snap → change stiffness (move damping with it).
        stiffness: 480,
        damping: 37,
        mass: 1,
      },
    },
    sceneStyleInterpolator: ({ current }) => ({
      sceneStyle: {
        transform: [
          {
            translateX: current.progress.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: [-width, 0, width],
            }),
          },
        ],
      },
    }),
  };
}

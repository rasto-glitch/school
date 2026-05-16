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
        // Near-critically damped: ζ ≈ 0.94 (critical damping for
        // stiffness 220, mass 1 is 2·√220 ≈ 29.7). Fast off the mark,
        // soft landing, no perceptible bounce.
        // Dial: snappier → raise stiffness (e.g. 280) and damping with it;
        //       softer/longer settle → lower stiffness (e.g. 170) or raise
        //       mass; if you ever see any bounce → set overshootClamping: true.
        stiffness: 220,
        damping: 28,
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

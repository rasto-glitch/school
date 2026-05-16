import { Easing } from 'react-native';
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
      animation: 'timing',
      config: {
        // ~Facebook-speed. Fast enough to feel instant; the strong decelerate
        // curve below is what keeps "fast" from reading as "abrupt/janky".
        duration: 210,
        // Decelerate — quick off the mark, soft landing. Native/iOS-like.
        easing: Easing.out(Easing.cubic),
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

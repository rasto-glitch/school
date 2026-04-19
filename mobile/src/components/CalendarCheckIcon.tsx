import Svg, { Path, Rect, Defs, Mask } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  fillColor?: string;
}

export default function CalendarCheckIcon({ size = 22, color, fillColor = 'none' }: Props) {
  const filled = fillColor !== 'none' && fillColor !== 'transparent';

  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Defs>
          <Mask id="cal-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <Rect x="0" y="0" width="24" height="24" fill="white" />
            <Path d="M3 10h18" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="m9 16 2 2 4-4" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Mask>
        </Defs>
        <Rect x="3" y="4" width="18" height="18" rx="2" fill={fillColor} mask="url(#cal-cutout)" />
        <Path d="M8 2v4" stroke={fillColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M16 2v4" stroke={fillColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 2v4" stroke={color} />
      <Path d="M16 2v4" stroke={color} />
      <Rect x="3" y="4" width="18" height="18" rx="2" stroke={color} />
      <Path d="M3 10h18" stroke={color} />
      <Path d="m9 16 2 2 4-4" stroke={color} />
    </Svg>
  );
}

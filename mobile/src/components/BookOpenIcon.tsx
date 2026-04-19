import Svg, { Path, Rect, Defs, Mask } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  fillColor?: string;
}

export default function BookOpenIcon({ size = 22, color, fillColor = 'none' }: Props) {
  const filled = fillColor !== 'none' && fillColor !== 'transparent';

  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Defs>
          <Mask id="book-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <Rect x="0" y="0" width="24" height="24" fill="white" />
            <Path d="M12 7v14" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M6 8h2" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M6 12h2" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M16 8h2" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M16 12h2" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Mask>
        </Defs>
        <Path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3z" fill={fillColor} mask="url(#book-cutout)" />
        <Path d="M21 18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3z" fill={fillColor} mask="url(#book-cutout)" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 7v14" stroke={color} />
      <Path d="M16 8h2" stroke={color} />
      <Path d="M16 12h2" stroke={color} />
      <Path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3z" stroke={color} />
      <Path d="M6 8h2" stroke={color} />
      <Path d="M6 12h2" stroke={color} />
      <Path d="M21 18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-5a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3z" stroke={color} />
    </Svg>
  );
}

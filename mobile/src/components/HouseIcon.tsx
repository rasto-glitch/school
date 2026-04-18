import Svg, { Path, Polyline } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  fillColor?: string;
  doorColor?: string;
}

export default function HouseIcon({ size = 22, color, fillColor = 'none', doorColor = 'none' }: Props) {
  const doorStroke = doorColor === 'none' ? color : doorColor;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={fillColor} stroke={color} />
      <Polyline points="9 22 9 12 15 12 15 22" fill={doorColor} stroke={doorStroke} />
    </Svg>
  );
}

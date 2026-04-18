import Svg, { Path, Polyline } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  fillColor?: string;
  doorColor?: string;
}

export default function HouseIcon({ size = 22, color, fillColor = 'none', doorColor = 'none' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={fillColor} />
      <Polyline points="9 22 9 12 15 12 15 22" fill={doorColor} />
    </Svg>
  );
}

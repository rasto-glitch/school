import Svg, { Path, Circle } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  fillColor?: string;
}

export default function BusIcon({ size = 22, color, fillColor = 'none' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" fill={fillColor} stroke={color} />
      <Path d="M2 12h19.6" stroke={color} />
      <Path d="M8 6v6" stroke={color} />
      <Path d="M15 6v6" stroke={color} />
      <Circle cx="7" cy="18" r="2" fill={fillColor} stroke={color} />
      <Circle cx="16" cy="18" r="2" fill={fillColor} stroke={color} />
      <Path d="M9 18h5" stroke={color} />
    </Svg>
  );
}

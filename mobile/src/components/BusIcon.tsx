import Svg, { Path, Circle, Defs, Mask, Rect } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  fillColor?: string;
}

export default function BusIcon({ size = 22, color, fillColor = 'none' }: Props) {
  const filled = fillColor !== 'none' && fillColor !== 'transparent';

  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Defs>
          <Mask id="bus-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <Rect x="0" y="0" width="24" height="24" fill="white" />
            <Path d="M2 12h19.6" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M8 6v6" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M15 6v6" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M9 18h5" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx="7" cy="18" r="2" fill="white" stroke="black" strokeWidth={2} />
            <Circle cx="16" cy="18" r="2" fill="white" stroke="black" strokeWidth={2} />
          </Mask>
        </Defs>
        <Path
          d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"
          fill={fillColor}
          mask="url(#bus-cutout)"
        />
        <Circle cx="7" cy="18" r="2" fill={fillColor} mask="url(#bus-cutout)" />
        <Circle cx="16" cy="18" r="2" fill={fillColor} mask="url(#bus-cutout)" />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" stroke={color} />
      <Path d="M2 12h19.6" stroke={color} />
      <Path d="M8 6v6" stroke={color} />
      <Path d="M15 6v6" stroke={color} />
      <Circle cx="7" cy="18" r="2" stroke={color} />
      <Circle cx="16" cy="18" r="2" stroke={color} />
      <Path d="M9 18h5" stroke={color} />
    </Svg>
  );
}

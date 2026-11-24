// src/widgets/FreeTimeWidget.android.tsx
import React from 'react';
import { FlexWidget, SvgWidget } from 'react-native-android-widget';

export interface FreeTimeWidgetProps {
  /**
   * True when there is ANY free time gap within the next `freeTimeDuration` hours.
   * False when the entire lookahead window is completely booked/full (renders faded/grayscale).
   */
  hasFreeTime: boolean;
}

/**
 * Generates an SVG string of the circular Free Time clock button icon matching
 * the in-app Floating Free Time button (`#1F2937` circle, `#3B82F6` ring, 3 o'clock clock face).
 * When `hasFreeTime` is false, renders a desaturated / faded grayscale state.
 */
function buildFreeTimeClockSvg(hasFreeTime: boolean): string {
  const outerBg = hasFreeTime ? '#1F2937' : '#262A30';
  const outerStroke = hasFreeTime ? '#3B82F6' : '#6B7280';
  const faceFill = hasFreeTime ? '#EFF6FF' : '#9CA3AF';
  const bezelStroke = hasFreeTime ? '#60A5FA' : '#6B7280';
  const handColor = hasFreeTime ? '#1D4ED8' : '#4B5563';
  const tickColor = hasFreeTime ? '#93C5FD' : '#6B7280';
  const overallOpacity = hasFreeTime ? '1.0' : '0.45';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
    <g opacity="${overallOpacity}">
      <circle cx="32" cy="32" r="29" fill="${outerBg}" stroke="${outerStroke}" stroke-width="3.5" />
      <circle cx="32" cy="32" r="18" fill="${faceFill}" stroke="${bezelStroke}" stroke-width="2.2" />
      <line x1="32" y1="16.5" x2="32" y2="19" stroke="${tickColor}" stroke-width="2" stroke-linecap="round" />
      <line x1="32" y1="45" x2="32" y2="47.5" stroke="${tickColor}" stroke-width="2" stroke-linecap="round" />
      <line x1="16.5" y1="32" x2="19" y2="32" stroke="${tickColor}" stroke-width="2" stroke-linecap="round" />
      <line x1="45" y1="32" x2="47.5" y2="32" stroke="${tickColor}" stroke-width="2" stroke-linecap="round" />
      <line x1="32" y1="32" x2="32" y2="21.5" stroke="${handColor}" stroke-width="2.8" stroke-linecap="round" />
      <line x1="32" y1="32" x2="40.5" y2="32" stroke="${handColor}" stroke-width="2.8" stroke-linecap="round" />
      <circle cx="32" cy="32" r="2.4" fill="${handColor}" />
    </g>
  </svg>`;
}

export function FreeTimeWidget({ hasFreeTime }: FreeTimeWidgetProps) {
  const svgString = buildFreeTimeClockSvg(hasFreeTime);

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'meatspoon://free-time' }}
      accessibilityLabel="MeatSpoon Free Time Finder"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 2,
      }}
    >
      <SvgWidget
        svg={svgString}
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'meatspoon://free-time' }}
        style={{
          width: 52,
          height: 52,
        }}
      />
    </FlexWidget>
  );
}

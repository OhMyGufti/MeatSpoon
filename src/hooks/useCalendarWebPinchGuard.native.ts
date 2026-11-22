// src/hooks/useCalendarWebPinchGuard.native.ts
import type { CalendarWebPinchGuardOptions } from './useCalendarWebPinchGuard';

/**
 * Native no-op; pinch-to-zoom is handled directly by React Native's PanResponder.
 */
export function useCalendarWebPinchGuard(
  _options: CalendarWebPinchGuardOptions
): void {}

export default useCalendarWebPinchGuard;

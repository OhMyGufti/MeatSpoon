export interface CalendarWebPinchGuardOptions {
  enabled: boolean;
  containerId: string;
  scrollContainerId?: string;
  onTrackpadPinch: (deltaY: number) => void;
}

export declare function useCalendarWebPinchGuard(
  options: CalendarWebPinchGuardOptions
): void;

export default useCalendarWebPinchGuard;

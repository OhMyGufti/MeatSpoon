// src/hooks/useCalendarWebPinchGuard.web.ts
import { useEffect, useRef } from 'react';
import type { CalendarWebPinchGuardOptions } from './useCalendarWebPinchGuard';

interface SingleTouchScrollState {
  startX: number;
  startY: number;
  startScrollTop: number;
  expectedScrollTop: number;
  nativeMoved: boolean;
  lockDirection: 'vertical' | 'horizontal' | null;
}

/**
 * Web / PWA pinch-to-zoom conflict guard.
 * - Ensures `touch-action: none` on the calendar container and `touch-action: pan-x pan-y` on `html, body`.
 * - Attaches non-passive (`{ passive: false }`) listeners on the calendar container & document
 *   to call `e.preventDefault()` on multi-touch pinch (`e.touches.length > 1`), Safari `gesturestart`/`gesturechange`,
 *   and desktop trackpad pinch (`wheel` with `e.ctrlKey === true`), while translating trackpad pinch into
 *   smooth calendar scaling and preserving single-finger vertical scroll inside the schedule grid.
 */
export function useCalendarWebPinchGuard({
  enabled,
  containerId,
  scrollContainerId,
  onTrackpadPinch,
}: CalendarWebPinchGuardOptions): void {
  const onTrackpadPinchRef = useRef(onTrackpadPinch);
  onTrackpadPinchRef.current = onTrackpadPinch;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const containerEl = document.getElementById(containerId);
    const scrollEl = scrollContainerId
      ? document.getElementById(scrollContainerId)
      : null;

    if (document.documentElement) {
      document.documentElement.style.touchAction = 'pan-x pan-y';
    }
    if (document.body) {
      document.body.style.touchAction = 'pan-x pan-y';
    }
    if (containerEl) {
      containerEl.style.touchAction = 'none';
    }

    let touchScrollState: SingleTouchScrollState | null = null;

    const handleContainerTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !scrollEl) {
        touchScrollState = null;
        return;
      }
      const targetNode = e.target as Node | null;
      if (!targetNode || !scrollEl.contains(targetNode)) {
        touchScrollState = null;
        return;
      }
      const t = e.touches[0];
      touchScrollState = {
        startX: t.clientX,
        startY: t.clientY,
        startScrollTop: scrollEl.scrollTop,
        expectedScrollTop: scrollEl.scrollTop,
        nativeMoved: false,
        lockDirection: null,
      };
    };

    const handleContainerTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        touchScrollState = null;
        return;
      }

      if (!touchScrollState || !scrollEl || e.touches.length !== 1) return;

      const t = e.touches[0];
      const dx = t.clientX - touchScrollState.startX;
      const dy = t.clientY - touchScrollState.startY;

      if (!touchScrollState.lockDirection) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
        touchScrollState.lockDirection =
          Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
      }

      if (touchScrollState.lockDirection === 'vertical') {
        if (
          !touchScrollState.nativeMoved &&
          Math.abs(scrollEl.scrollTop - touchScrollState.expectedScrollTop) > 1
        ) {
          touchScrollState.nativeMoved = true;
        }
        if (!touchScrollState.nativeMoved) {
          e.preventDefault();
          scrollEl.scrollTop = touchScrollState.startScrollTop - dy;
          touchScrollState.expectedScrollTop = scrollEl.scrollTop;
        }
      }
    };

    const resetTouchScroll = () => {
      touchScrollState = null;
    };

    const handleDocumentTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const preventSafariGesture = (e: Event) => {
      e.preventDefault();
    };

    const handleContainerWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        onTrackpadPinchRef.current(e.deltaY);
      }
    };

    const handleDocumentWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    if (containerEl) {
      containerEl.addEventListener('touchstart', handleContainerTouchStart, {
        passive: true,
      });
      containerEl.addEventListener('touchmove', handleContainerTouchMove, {
        passive: false,
      });
      containerEl.addEventListener('touchend', resetTouchScroll, {
        passive: true,
      });
      containerEl.addEventListener('touchcancel', resetTouchScroll, {
        passive: true,
      });
      containerEl.addEventListener('gesturestart', preventSafariGesture, {
        passive: false,
      } as AddEventListenerOptions);
      containerEl.addEventListener('gesturechange', preventSafariGesture, {
        passive: false,
      } as AddEventListenerOptions);
      containerEl.addEventListener('wheel', handleContainerWheel, {
        passive: false,
      });
    }

    document.addEventListener('touchmove', handleDocumentTouchMove, {
      passive: false,
    });
    document.addEventListener('gesturestart', preventSafariGesture, {
      passive: false,
    } as AddEventListenerOptions);
    document.addEventListener('gesturechange', preventSafariGesture, {
      passive: false,
    } as AddEventListenerOptions);
    document.addEventListener('wheel', handleDocumentWheel, {
      passive: false,
    });

    return () => {
      if (containerEl) {
        containerEl.removeEventListener('touchstart', handleContainerTouchStart);
        containerEl.removeEventListener('touchmove', handleContainerTouchMove);
        containerEl.removeEventListener('touchend', resetTouchScroll);
        containerEl.removeEventListener('touchcancel', resetTouchScroll);
        containerEl.removeEventListener('gesturestart', preventSafariGesture);
        containerEl.removeEventListener('gesturechange', preventSafariGesture);
        containerEl.removeEventListener('wheel', handleContainerWheel);
      }
      document.removeEventListener('touchmove', handleDocumentTouchMove);
      document.removeEventListener('gesturestart', preventSafariGesture);
      document.removeEventListener('gesturechange', preventSafariGesture);
      document.removeEventListener('wheel', handleDocumentWheel);
    };
  }, [enabled, containerId, scrollContainerId]);
}

export default useCalendarWebPinchGuard;

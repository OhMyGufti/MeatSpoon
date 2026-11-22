// src/hooks/useMenuBackHandler.web.ts
import { useEffect, useRef } from 'react';

interface ActiveWebMenuEntry {
  id: number;
  close: () => void;
}

let nextEntryId = 1;
const activeEntries: ActiveWebMenuEntry[] = [];
let pushedHistoryCount = 0;
let programmaticBackIgnoreCount = 0;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let popStateListenerAttached = false;

function handleGlobalPopState() {
  if (programmaticBackIgnoreCount > 0) {
    programmaticBackIgnoreCount -= 1;
    return;
  }

  if (pushedHistoryCount > 0) {
    pushedHistoryCount -= 1;
  }

  const topEntry = activeEntries.pop();
  if (topEntry) {
    topEntry.close();
  }
}

function ensureGlobalPopStateListener() {
  if (popStateListenerAttached || typeof window === 'undefined') return;
  window.addEventListener('popstate', handleGlobalPopState);
  popStateListenerAttached = true;
}

function scheduleHistorySync() {
  if (typeof window === 'undefined' || !window.history) return;
  if (syncTimer !== null) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    const targetDepth = activeEntries.length;

    while (pushedHistoryCount < targetDepth) {
      window.history.pushState({ menuOpen: true }, '');
      pushedHistoryCount += 1;
    }

    while (pushedHistoryCount > targetDepth) {
      pushedHistoryCount -= 1;
      programmaticBackIgnoreCount += 1;
      window.history.back();
    }
  }, 0);
}

/**
 * Web / PWA Back button handler for menus, modals, and drawers.
 * - When a menu opens, pushes `{ menuOpen: true }` onto `window.history`.
 * - Listens to `popstate` so pressing the browser/device Back button closes the open menu.
 * - When the menu is closed via an on-screen Close button, pops the dummy history
 *   entry (`window.history.back()`) without polluting browser history or misfiring
 *   when transitioning directly from one menu to another.
 */
export function useMenuBackHandler(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    ensureGlobalPopStateListener();

    const entryId = nextEntryId++;
    const entry: ActiveWebMenuEntry = {
      id: entryId,
      close: () => onCloseRef.current(),
    };
    activeEntries.push(entry);
    scheduleHistorySync();

    return () => {
      const idx = activeEntries.findIndex((item) => item.id === entryId);
      if (idx !== -1) {
        activeEntries.splice(idx, 1);
      }
      scheduleHistorySync();
    };
  }, [isOpen]);
}

export default useMenuBackHandler;

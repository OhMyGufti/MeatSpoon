// src/hooks/useMenuBackHandler.native.ts
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Native (Android / iOS) Back button handler for menus, modals, and drawers.
 * Intercepts Android's hardware/system Back press while `isOpen` is true,
 * closes the menu via `onClose()`, and returns `true` so the app does not exit.
 */
export function useMenuBackHandler(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onCloseRef.current();
        return true;
      }
    );

    return () => {
      subscription.remove();
    };
  }, [isOpen]);
}

export default useMenuBackHandler;

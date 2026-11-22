import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { normalizeHexColor } from '../utils/colorPalette';
import { BaseColorPickerProps } from './BaseColorPicker.types';

/**
 * Web / PWA Base Color Picker swatch.
 * Overlays a native `<input type="color">` directly over the clickable swatch so tapping
 * opens the OS/browser visual color picker cleanly on Desktop, Android Chrome, and iOS Safari PWAs.
 */
export default function BaseColorPicker({
  color,
  onSelectColor,
}: BaseColorPickerProps) {
  const safeHex = normalizeHexColor(color) || '#3B82F6';
  const lastEmittedRef = useRef<string>(safeHex);

  const handleDomColorEvent = (rawVal: string) => {
    const normalized = normalizeHexColor(rawVal);
    if (normalized && normalized !== lastEmittedRef.current) {
      lastEmittedRef.current = normalized;
      onSelectColor(normalized);
    }
  };

  return (
    <View style={[styles.swatchWrapper, { backgroundColor: safeHex }]}>
      <View style={styles.editBadge} pointerEvents="none">
        <Text style={styles.editBadgeText}>🎨</Text>
      </View>
      <input
        type="color"
        aria-label="Pick base palette color"
        title="Tap to pick base color"
        value={safeHex}
        onChange={(e) => handleDomColorEvent(e.target.value)}
        onInput={(e) =>
          handleDomColorEvent((e.target as HTMLInputElement).value)
        }
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          border: 'none',
          padding: 0,
          margin: 0,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  swatchWrapper: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#F9FAFB',
    position: 'relative',
    overflow: 'visible',
  },
  editBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadgeText: {
    fontSize: 9,
  },
});

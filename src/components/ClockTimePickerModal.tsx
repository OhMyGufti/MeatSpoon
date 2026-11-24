// src/components/ClockTimePickerModal.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface ClockTimePickerModalProps {
  visible: boolean;
  label?: string;
  initialDecimalHour: number;
  accentColor?: string;
  onConfirm: (decimalHour: number, formattedHHMM: string) => void;
  onCancel: () => void;
}

const DIAL_SIZE = 264;
const CENTER = DIAL_SIZE / 2; // 132
const OUTER_RADIUS = 98;
const INNER_RADIUS = 60;
const RING_SPLIT_RADIUS = (OUTER_RADIUS + INNER_RADIUS) / 2; // 79
const BUBBLE_SIZE = 36;
const BUBBLE_HALF = BUBBLE_SIZE / 2;

// Inner ring: 12, 1, 2, ..., 11
const INNER_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
// Outer ring: 00, 13, 14, ..., 23
const OUTER_HOURS = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
// Minute ring (5-minute markers): 00, 05, 10, ..., 55
const MINUTE_MARKERS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/**
 * Converts a decimal hour (e.g. 10.5 or "10.5") or "HH:MM" string into { hours, minutes }.
 */
export function parseTimeValueToParts(value: number | string): {
  hours: number;
  minutes: number;
} {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
    if (colonMatch) {
      const h = Math.max(0, Math.min(23, parseInt(colonMatch[1], 10) || 0));
      const m = Math.max(0, Math.min(59, parseInt(colonMatch[2], 10) || 0));
      return { hours: h, minutes: m };
    }
    const parsedNum = parseFloat(trimmed);
    if (!Number.isNaN(parsedNum)) {
      return parseTimeValueToParts(parsedNum);
    }
    return { hours: 12, minutes: 0 };
  }

  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return { hours: 12, minutes: 0 };
  }

  const clamped = Math.max(0, Math.min(23.99, value));
  let hours = Math.floor(clamped);
  let minutes = Math.round((clamped - hours) * 60);
  if (minutes >= 60) {
    hours = Math.min(23, hours + 1);
    minutes = 0;
  }
  return { hours, minutes };
}

/**
 * Formats a decimal hour or "HH:MM" string as "HH:MM" (e.g. 10.5 -> "10:30").
 */
export function formatDecimalHourToHHMM(value: number | string): string {
  const { hours, minutes } = parseTimeValueToParts(value);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Converts { hours, minutes } or "HH:MM" or decimal string to a decimal hour number (e.g. "10:30" -> 10.5).
 */
export function timeValueToDecimalHour(value: number | string): number {
  const { hours, minutes } = parseTimeValueToParts(value);
  return Number((hours + minutes / 60).toFixed(4));
}

function getClockIndexPosition(
  index12: number,
  radius: number
): { x: number; y: number } {
  const angleRad = ((index12 * 30 - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angleRad),
    y: CENTER + radius * Math.sin(angleRad),
  };
}

export default function ClockTimePickerModal({
  visible,
  label = 'Select Time',
  initialDecimalHour,
  accentColor = '#3B82F6',
  onConfirm,
  onCancel,
}: ClockTimePickerModalProps) {
  const initialParts = useMemo(
    () => parseTimeValueToParts(initialDecimalHour),
    [initialDecimalHour]
  );

  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [selectedHour, setSelectedHour] = useState<number>(initialParts.hours);
  const [selectedMinute, setSelectedMinute] = useState<number>(
    initialParts.minutes
  );

  const modeRef = useRef<'hour' | 'minute'>(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (visible) {
      const parts = parseTimeValueToParts(initialDecimalHour);
      setSelectedHour(parts.hours);
      setSelectedMinute(parts.minutes);
      setMode('hour');
    }
  }, [visible, initialDecimalHour]);

  const updateFromDialTouch = (
    localX: number,
    localY: number,
    isRelease: boolean
  ) => {
    const dx = localX - CENTER;
    const dy = localY - CENTER;
    const dist = Math.hypot(dx, dy);
    // Ignore accidental dead-center taps
    if (dist < 16) return;

    const degFrom12 = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;

    if (modeRef.current === 'hour') {
      const sector = Math.round(degFrom12 / 30) % 12;
      const isInner = dist < RING_SPLIT_RADIUS;
      const nextHour = isInner
        ? INNER_HOURS[sector]
        : OUTER_HOURS[sector];
      setSelectedHour(nextHour);
      if (isRelease) {
        setMode('minute');
      }
    } else {
      // Snap to 5-minute increments for clean schedule alignment
      const snapped5 = (Math.round(degFrom12 / 30) * 5) % 60;
      setSelectedMinute(snapped5);
    }
  };

  const extractLocalCoords = (
    evt: GestureResponderEvent
  ): { x: number; y: number } | null => {
    const ne = evt.nativeEvent as unknown as {
      locationX?: number;
      locationY?: number;
      offsetX?: number;
      offsetY?: number;
    };
    const lx =
      typeof ne.locationX === 'number'
        ? ne.locationX
        : typeof ne.offsetX === 'number'
        ? ne.offsetX
        : null;
    const ly =
      typeof ne.locationY === 'number'
        ? ne.locationY
        : typeof ne.offsetY === 'number'
        ? ne.offsetY
        : null;
    if (lx === null || ly === null) return null;
    return { x: lx, y: ly };
  };

  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);

  const dialPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const coords = extractLocalCoords(evt);
          if (coords) {
            dragOriginRef.current = coords;
            updateFromDialTouch(coords.x, coords.y, false);
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          if (dragOriginRef.current) {
            updateFromDialTouch(
              dragOriginRef.current.x + gestureState.dx,
              dragOriginRef.current.y + gestureState.dy,
              false
            );
          } else {
            const coords = extractLocalCoords(evt);
            if (coords) {
              updateFromDialTouch(coords.x, coords.y, false);
            }
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          if (dragOriginRef.current) {
            updateFromDialTouch(
              dragOriginRef.current.x + gestureState.dx,
              dragOriginRef.current.y + gestureState.dy,
              true
            );
          } else {
            const coords = extractLocalCoords(evt);
            if (coords) {
              updateFromDialTouch(coords.x, coords.y, true);
            } else if (modeRef.current === 'hour') {
              setMode('minute');
            }
          }
          dragOriginRef.current = null;
        },
      }),
    []
  );

  // Compute hand target coordinates
  const handTarget = useMemo(() => {
    if (mode === 'hour') {
      const isInner = selectedHour >= 1 && selectedHour <= 12;
      const radius = isInner ? INNER_RADIUS : OUTER_RADIUS;
      const idx12 = selectedHour % 12;
      return getClockIndexPosition(idx12, radius);
    } else {
      const angleRad = ((selectedMinute * 6 - 90) * Math.PI) / 180;
      return {
        x: CENTER + OUTER_RADIUS * Math.cos(angleRad),
        y: CENTER + OUTER_RADIUS * Math.sin(angleRad),
      };
    }
  }, [mode, selectedHour, selectedMinute]);

  const handGeometry = useMemo(() => {
    const dx = handTarget.x - CENTER;
    const dy = handTarget.y - CENTER;
    const length = Math.hypot(dx, dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const midX = (CENTER + handTarget.x) / 2;
    const midY = (CENTER + handTarget.y) / 2;
    return {
      length,
      angleDeg,
      left: midX - length / 2,
      top: midY - 1.25,
    };
  }, [handTarget]);

  const formattedHH = String(selectedHour).padStart(2, '0');
  const formattedMM = String(selectedMinute).padStart(2, '0');

  const handleConfirmPress = () => {
    const dec = Number((selectedHour + selectedMinute / 60).toFixed(4));
    onConfirm(dec, `${formattedHH}:${formattedMM}`);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onCancel}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.card}
          onPress={() => {}}
        >
          <Text style={styles.headerLabel}>{label}</Text>

          {/* Digital Header: HH : MM */}
          <View style={styles.digitalHeaderRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setMode('hour')}
              style={[
                styles.digitalTimeBox,
                mode === 'hour' && {
                  backgroundColor: `${accentColor}26`,
                  borderColor: accentColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.digitalTimeText,
                  mode === 'hour' && { color: accentColor },
                ]}
              >
                {formattedHH}
              </Text>
            </TouchableOpacity>

            <Text style={styles.digitalColon}>:</Text>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setMode('minute')}
              style={[
                styles.digitalTimeBox,
                mode === 'minute' && {
                  backgroundColor: `${accentColor}26`,
                  borderColor: accentColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.digitalTimeText,
                  mode === 'minute' && { color: accentColor },
                ]}
              >
                {formattedMM}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.stepSubtitle}>
            {mode === 'hour'
              ? 'Step 1: Pick Hour (24h)'
              : 'Step 2: Pick Minutes'}
          </Text>

          {/* 24-Hour Analog Dial */}
          <View style={styles.dialWrapper}>
            <View style={styles.dialCircle} {...dialPanResponder.panHandlers}>
              {/* Clock Hand Line */}
              <View
                pointerEvents="none"
                style={[
                  styles.handLine,
                  {
                    width: handGeometry.length,
                    left: handGeometry.left,
                    top: handGeometry.top,
                    backgroundColor: accentColor,
                    transform: [{ rotate: `${handGeometry.angleDeg}deg` }],
                  },
                ]}
              />

              {/* Center Pin Dot */}
              <View
                pointerEvents="none"
                style={[styles.centerDot, { backgroundColor: accentColor }]}
              />

              {/* Highlighted Target Circle at end of Hand */}
              <View
                pointerEvents="none"
                style={[
                  styles.selectedHighlightBubble,
                  {
                    left: handTarget.x - BUBBLE_HALF,
                    top: handTarget.y - BUBBLE_HALF,
                    backgroundColor: accentColor,
                  },
                ]}
              />

              {mode === 'hour' ? (
                <>
                  {/* Outer Ring: 00, 13..23 */}
                  {OUTER_HOURS.map((hr, idx) => {
                    const pos = getClockIndexPosition(idx, OUTER_RADIUS);
                    const isSelected = selectedHour === hr;
                    return (
                      <TouchableOpacity
                        key={`outer-${hr}`}
                        activeOpacity={0.8}
                        onPress={() => {
                          setSelectedHour(hr);
                          setMode('minute');
                        }}
                        style={[
                          styles.numberBubble,
                          {
                            left: pos.x - BUBBLE_HALF,
                            top: pos.y - BUBBLE_HALF,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.outerHourText,
                            isSelected && styles.selectedNumberText,
                          ]}
                        >
                          {String(hr).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* Inner Ring: 12, 1..11 */}
                  {INNER_HOURS.map((hr, idx) => {
                    const pos = getClockIndexPosition(idx, INNER_RADIUS);
                    const isSelected = selectedHour === hr;
                    return (
                      <TouchableOpacity
                        key={`inner-${hr}`}
                        activeOpacity={0.8}
                        onPress={() => {
                          setSelectedHour(hr);
                          setMode('minute');
                        }}
                        style={[
                          styles.numberBubble,
                          {
                            left: pos.x - BUBBLE_HALF,
                            top: pos.y - BUBBLE_HALF,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.innerHourText,
                            isSelected && styles.selectedNumberText,
                          ]}
                        >
                          {hr}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                /* Minute Ring: 00, 05, 10, ..., 55 */
                MINUTE_MARKERS.map((minVal, idx) => {
                  const pos = getClockIndexPosition(idx, OUTER_RADIUS);
                  const isSelected = selectedMinute === minVal;
                  return (
                    <TouchableOpacity
                      key={`min-${minVal}`}
                      activeOpacity={0.8}
                      onPress={() => setSelectedMinute(minVal)}
                      style={[
                        styles.numberBubble,
                        {
                          left: pos.x - BUBBLE_HALF,
                          top: pos.y - BUBBLE_HALF,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.outerHourText,
                          isSelected && styles.selectedNumberText,
                        ]}
                      >
                        {String(minVal).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>

          {/* Bottom Action Row */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              activeOpacity={0.8}
              onPress={onCancel}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: accentColor }]}
              activeOpacity={0.85}
              onPress={handleConfirmPress}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: 312,
    backgroundColor: '#111827',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#374151',
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  headerLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  digitalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 6,
  },
  digitalTimeBox: {
    backgroundColor: '#1F2937',
    borderWidth: 1.5,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 78,
    alignItems: 'center',
  },
  digitalTimeText: {
    color: '#F9FAFB',
    fontSize: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  digitalColon: {
    color: '#9CA3AF',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 2,
  },
  stepSubtitle: {
    color: '#9CA3AF',
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 12,
  },
  dialWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  dialCircle: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_SIZE / 2,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    position: 'relative',
  },
  centerDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    left: CENTER - 5,
    top: CENTER - 5,
    zIndex: 3,
  },
  handLine: {
    position: 'absolute',
    height: 2.5,
    zIndex: 2,
  },
  selectedHighlightBubble: {
    position: 'absolute',
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_HALF,
    zIndex: 2,
  },
  numberBubble: {
    position: 'absolute',
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_HALF,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  outerHourText: {
    color: '#F9FAFB',
    fontSize: 13.5,
    fontWeight: '700',
  },
  innerHourText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '700',
  },
  selectedNumberText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  cancelBtnText: {
    color: '#D1D5DB',
    fontSize: 13.5,
    fontWeight: '700',
  },
  doneBtn: {
    paddingVertical: 9,
    paddingHorizontal: 22,
    borderRadius: 10,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
});

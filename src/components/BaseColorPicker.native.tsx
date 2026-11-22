import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMenuBackHandler } from '../hooks/useMenuBackHandler';
import { hexToHsl, hslToHex, normalizeHexColor } from '../utils/colorPalette';
import { BaseColorPickerProps } from './BaseColorPicker.types';

const HUE_STOP_COUNT = 36;
const SL_STOP_COUNT = 16;
const SPECTRUM_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const SPECTRUM_LIGHTNESS_ROWS = [0.76, 0.62, 0.5, 0.38, 0.26];

interface HslSliderProps {
  label: string;
  valueLabel: string;
  ratio: number;
  stops: string[];
  thumbColor: string;
  onChangeRatio: (nextRatio: number) => void;
}

function HslSlider({
  label,
  valueLabel,
  ratio,
  stops,
  thumbColor,
  onChangeRatio,
}: HslSliderProps) {
  const trackWidthRef = useRef<number>(240);
  const startLocationXRef = useRef<number>(0);
  const onChangeRef = useRef(onChangeRatio);
  onChangeRef.current = onChangeRatio;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        const w = Math.max(1, trackWidthRef.current);
        const x = evt.nativeEvent.locationX ?? 0;
        startLocationXRef.current = x;
        onChangeRef.current(Math.max(0, Math.min(1, x / w)));
      },
      onPanResponderMove: (_, gestureState) => {
        const w = Math.max(1, trackWidthRef.current);
        const x = startLocationXRef.current + gestureState.dx;
        onChangeRef.current(Math.max(0, Math.min(1, x / w)));
      },
      onShouldBlockNativeResponder: () => true,
    })
  ).current;

  const clampedRatio = Math.max(0, Math.min(1, ratio));

  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.sliderLabelText}>{label}</Text>
        <Text style={styles.sliderValueText}>{valueLabel}</Text>
      </View>
      <View
        style={styles.sliderTrackHitbox}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0) trackWidthRef.current = w;
        }}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderTrack} pointerEvents="none">
          {stops.map((stopColor, idx) => (
            <View
              key={idx}
              style={{ flex: 1, height: '100%', backgroundColor: stopColor }}
            />
          ))}
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.sliderThumb,
            {
              left: `${clampedRatio * 100}%`,
              backgroundColor: thumbColor,
            },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Native (Android / iOS) Base Color Picker swatch + visual HSL Color Picker Modal.
 */
export default function BaseColorPicker({
  color,
  onSelectColor,
}: BaseColorPickerProps) {
  const safeHex = normalizeHexColor(color) || '#3B82F6';
  const [modalVisible, setModalVisible] = useState(false);

  const initialHsl = useMemo(() => hexToHsl(safeHex), [safeHex]);
  const [hue, setHue] = useState<number>(initialHsl.h);
  const [sat, setSat] = useState<number>(initialHsl.s);
  const [light, setLight] = useState<number>(initialHsl.l);

  useMenuBackHandler(modalVisible, () => setModalVisible(false));

  const openPicker = () => {
    const parsed = hexToHsl(safeHex);
    setHue(parsed.h);
    setSat(parsed.s);
    setLight(parsed.l);
    setModalVisible(true);
  };

  const draftHex = useMemo(() => hslToHex(hue, sat, light), [hue, sat, light]);

  const hueStops = useMemo(
    () =>
      Array.from({ length: HUE_STOP_COUNT }, (_, i) =>
        hslToHex((i / HUE_STOP_COUNT) * 360, Math.max(0.7, sat), 0.5)
      ),
    [sat]
  );

  const satStops = useMemo(
    () =>
      Array.from({ length: SL_STOP_COUNT }, (_, i) =>
        hslToHex(hue, i / (SL_STOP_COUNT - 1), light)
      ),
    [hue, light]
  );

  const lightStops = useMemo(
    () =>
      Array.from({ length: SL_STOP_COUNT }, (_, i) =>
        hslToHex(hue, sat, 0.12 + (i / (SL_STOP_COUNT - 1)) * 0.76)
      ),
    [hue, sat]
  );

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={openPicker}
        style={[styles.swatchWrapper, { backgroundColor: safeHex }]}
      >
        <View style={styles.editBadge}>
          <Text style={styles.editBadgeText}>🎨</Text>
        </View>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeaderRow}>
              <Text style={styles.pickerTitle}>🎨 Pick Base Color</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.pickerCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Live Selected Color Preview Banner */}
            <View style={styles.previewBanner}>
              <View
                style={[styles.previewSwatchBox, { backgroundColor: draftHex }]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.previewHexText}>{draftHex}</Text>
                <Text style={styles.previewHslText}>
                  H: {Math.round(hue)}° • S: {Math.round(sat * 100)}% • L:{' '}
                  {Math.round(light * 100)}%
                </Text>
              </View>
            </View>

            {/* Quick 2D Spectrum Swatches */}
            <Text style={styles.sectionHint}>Color Spectrum:</Text>
            <View style={styles.spectrumGrid}>
              {SPECTRUM_LIGHTNESS_ROWS.map((lVal) => (
                <View key={`row-${lVal}`} style={styles.spectrumRow}>
                  {SPECTRUM_HUES.map((hVal) => {
                    const cellHex = hslToHex(hVal, 0.85, lVal);
                    const isSelected = cellHex === draftHex;
                    return (
                      <TouchableOpacity
                        key={`${hVal}-${lVal}`}
                        activeOpacity={0.75}
                        onPress={() => {
                          setHue(hVal);
                          setSat(0.85);
                          setLight(lVal);
                        }}
                        style={[
                          styles.spectrumCell,
                          { backgroundColor: cellHex },
                          isSelected && styles.spectrumCellSelected,
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Continuous Draggable HSL Sliders */}
            <HslSlider
              label="Hue"
              valueLabel={`${Math.round(hue)}°`}
              ratio={hue / 360}
              stops={hueStops}
              thumbColor={hslToHex(hue, 0.9, 0.5)}
              onChangeRatio={(r) => setHue(r * 360)}
            />

            <HslSlider
              label="Saturation"
              valueLabel={`${Math.round(sat * 100)}%`}
              ratio={sat}
              stops={satStops}
              thumbColor={draftHex}
              onChangeRatio={setSat}
            />

            <HslSlider
              label="Lightness"
              valueLabel={`${Math.round(light * 100)}%`}
              ratio={(light - 0.12) / 0.76}
              stops={lightStops}
              thumbColor={draftHex}
              onChangeRatio={(r) => setLight(0.12 + r * 0.76)}
            />

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.actionBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.applyBtn}
                onPress={() => {
                  onSelectColor(draftHex);
                  setModalVisible(false);
                }}
              >
                <Text style={styles.actionBtnText}>Apply Color</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  pickerCard: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 16,
  },
  pickerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pickerTitle: {
    color: '#F9FAFB',
    fontSize: 17,
    fontWeight: '800',
  },
  pickerCloseText: {
    color: '#9CA3AF',
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 10,
    marginBottom: 12,
  },
  previewSwatchBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  previewHexText: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '800',
  },
  previewHslText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  sectionHint: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  spectrumGrid: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 12,
  },
  spectrumRow: {
    flexDirection: 'row',
  },
  spectrumCell: {
    flex: 1,
    height: 24,
  },
  spectrumCellSelected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  sliderBlock: {
    marginBottom: 10,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sliderLabelText: {
    color: '#D1D5DB',
    fontSize: 12,
    fontWeight: '700',
  },
  sliderValueText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  sliderTrackHitbox: {
    height: 28,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#374151',
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    marginLeft: -11,
    elevation: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#374151',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  applyBtn: {
    flex: 1.4,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});

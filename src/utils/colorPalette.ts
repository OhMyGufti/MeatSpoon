// src/utils/colorPalette.ts

export type PaletteMode = 'analog' | 'golden-angle' | 'polychromatic';

export const DEFAULT_COLOR_PALETTE: string[] = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#8B5CF6', // Violet
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#EF4444', // Red
  '#14B8A6', // Teal
  '#6366F1', // Indigo
];

export const PALETTE_MODE_OPTIONS: {
  id: PaletteMode;
  label: string;
  formulaDesc: string;
}[] = [
  {
    id: 'analog',
    label: 'Analog',
    formulaDesc: '±15° steps',
  },
  {
    id: 'golden-angle',
    label: 'Golden Angle',
    formulaDesc: '137.5° steps',
  },
  {
    id: 'polychromatic',
    label: 'Balanced Polychromatic',
    formulaDesc: '45° wheel',
  },
];

const ANALOG_OFFSETS = [-60, -45, -30, -15, 0, 15, 30, 45];
const GOLDEN_ANGLE_OFFSETS = Array.from({ length: 8 }, (_, i) => i * 137.5);
const POLYCHROMATIC_OFFSETS = Array.from({ length: 8 }, (_, i) => i * 45);

export function isValidPaletteMode(val: unknown): val is PaletteMode {
  return (
    val === 'analog' || val === 'golden-angle' || val === 'polychromatic'
  );
}

export function getPaletteStepOffsets(mode: PaletteMode): number[] {
  switch (mode) {
    case 'golden-angle':
      return GOLDEN_ANGLE_OFFSETS;
    case 'polychromatic':
      return POLYCHROMATIC_OFFSETS;
    case 'analog':
    default:
      return ANALOG_OFFSETS;
  }
}

export function getBaseColorSwatchIndex(mode: PaletteMode): number {
  return mode === 'analog' ? 4 : 0;
}

export function getPaletteStepLabels(mode: PaletteMode): string[] {
  const offsets = getPaletteStepOffsets(mode);
  if (mode === 'analog') {
    return offsets.map((deg) => (deg > 0 ? `+${deg}°` : `${deg}°`));
  }
  return offsets.map((deg, idx) => {
    if (idx === 0) return 'Base';
    const wrapped = Math.round((deg % 360) * 10) / 10;
    return `+${wrapped}°`;
  });
}

/**
 * Validates and normalizes a user-entered HEX color string into uppercase `#RRGGBB`.
 * Returns `null` if the string is not a valid 3-digit or 6-digit HEX color.
 */
export function normalizeHexColor(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const r = cleaned[0];
    const g = cleaned[1];
    const b = cleaned[2];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    return `#${cleaned}`.toUpperCase();
  }
  return null;
}

/**
 * Converts a `#RRGGBB` HEX color to HSL `(h, s, l)` where:
 * - `h` is in `[0, 360)`
 * - `s` is in `[0, 1]`
 * - `l` is in `[0, 1]`
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const normalized = normalizeHexColor(hex) || '#3B82F6';
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
    h = ((h % 360) + 360) % 360;
  }

  return { h, s, l };
}

/**
 * Converts HSL `(h, s, l)` (with `h` in `0..360`, `s` in `0..1`, `l` in `0..1`)
 * back into an uppercase `#RRGGBB` HEX string.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const wrappedHue = ((h % 360) + 360) % 360;
  const clampedS = Math.max(0, Math.min(1, s));
  const clampedL = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * clampedL - 1)) * clampedS;
  const x = c * (1 - Math.abs(((wrappedHue / 60) % 2) - 1));
  const m = clampedL - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (wrappedHue >= 0 && wrappedHue < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (wrappedHue >= 60 && wrappedHue < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (wrappedHue >= 120 && wrappedHue < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (wrappedHue >= 180 && wrappedHue < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (wrappedHue >= 240 && wrappedHue < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }

  const toHexByte = (channel: number) =>
    Math.round(Math.max(0, Math.min(255, (channel + m) * 255)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  return `#${toHexByte(r1)}${toHexByte(g1)}${toHexByte(b1)}`;
}

/**
 * Generates an 8-color HEX palette from a base HEX color using the selected mode:
 * - `'analog'`: `-60°, -45°, -30°, -15°, 0°, +15°, +30°, +45°`
 * - `'golden-angle'`: `H_i = (H + i * 137.5) % 360` for `i = 0..7`
 * - `'polychromatic'`: `H_i = (H + i * 45) % 360` for `i = 0..7`
 * Keeps S and L constant for all 8 colors and wraps hue modulo `0-360`.
 */
export function generateCustomPaletteFromHex(
  baseHex: string,
  mode: PaletteMode = 'analog'
): string[] | null {
  const normalized = normalizeHexColor(baseHex);
  if (!normalized) return null;

  const { h, s, l } = hexToHsl(normalized);
  const offsets = getPaletteStepOffsets(mode);

  return offsets.map((offset) => {
    const shiftedHue = (((h + offset) % 360) + 360) % 360;
    return hslToHex(shiftedHue, s, l);
  });
}

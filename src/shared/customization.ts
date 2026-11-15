import type {
  BoostEffectStyle,
  CarBodyStyle,
  CarCustomization,
  DecalStyle,
  PaintFinish,
  SpoilerStyle,
  TopperStyle,
  TrimStyle,
  WheelStyle,
  WindowTint,
} from './types';
import { DEFAULT_CUSTOMIZATION_BLUE } from './types';
import { CAR_RIDE_HEIGHT } from './arena';
import { BOOST_EFFECT_OPTIONS, isValidBoostEffect } from './boostEffects';

export { BOOST_EFFECT_OPTIONS };

export interface ExhaustPortSpec {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface CarBodySpec {
  id: CarBodyStyle;
  label: string;
  tagline: string;
  bodyWidth: number;
  bodyLength: number;
  chassisHeight: number;
  frontWheelRadius: number;
  rearWheelRadius: number;
  frontTireWidth: number;
  rearTireWidth: number;
  frontAxleZ: number;
  rearAxleZ: number;
  frontTrackHalfWidth: number;
  rearTrackHalfWidth: number;
  roofY: number;
  roofZ: number;
  wingY: number;
  wingZ: number;
  wingWidth: number;
  exhausts: ExhaustPortSpec[];
}

export const BODY_GEOMETRY_SPECS: Record<CarBodyStyle, CarBodySpec> = {
  octane: {
    id: 'octane',
    label: 'Octane Turbo',
    tagline: 'Buggy rally alta & reattiva',
    bodyWidth: 1.18,
    bodyLength: 3.52,
    chassisHeight: 0.96,
    frontWheelRadius: 0.35,
    rearWheelRadius: 0.38,
    frontTireWidth: 0.28,
    rearTireWidth: 0.34,
    frontAxleZ: 1.18,
    rearAxleZ: -1.14,
    frontTrackHalfWidth: 0.88,
    rearTrackHalfWidth: 0.92,
    roofY: 0.65,
    roofZ: -0.18,
    wingY: 0.78,
    wingZ: -1.52,
    wingWidth: 1.78,
    exhausts: [
      { x: -0.34, y: 0.24, z: -1.68, radius: 0.16 },
      { x: 0.34, y: 0.24, z: -1.68, radius: 0.16 },
    ],
  },
  dominus: {
    id: 'dominus',
    label: 'Dominus GT',
    tagline: 'Muscle V8 larga con compressore',
    bodyWidth: 1.62,
    bodyLength: 3.76,
    chassisHeight: 0.78,
    frontWheelRadius: 0.35,
    rearWheelRadius: 0.37,
    frontTireWidth: 0.30,
    rearTireWidth: 0.35,
    frontAxleZ: 1.24,
    rearAxleZ: -1.16,
    frontTrackHalfWidth: 0.87,
    rearTrackHalfWidth: 0.90,
    roofY: 0.54,
    roofZ: -0.24,
    wingY: 0.58,
    wingZ: -1.66,
    wingWidth: 1.84,
    exhausts: [
      { x: -0.50, y: 0.02, z: -1.86, radius: 0.14 },
      { x: 0.50, y: 0.02, z: -1.86, radius: 0.14 },
    ],
  },
  fennec: {
    id: 'fennec',
    label: 'Fennec RS',
    tagline: 'Hatchback widebody Gruppo B',
    bodyWidth: 1.58,
    bodyLength: 3.36,
    chassisHeight: 1.10,
    frontWheelRadius: 0.37,
    rearWheelRadius: 0.37,
    frontTireWidth: 0.32,
    rearTireWidth: 0.32,
    frontAxleZ: 1.12,
    rearAxleZ: -1.10,
    frontTrackHalfWidth: 0.89,
    rearTrackHalfWidth: 0.91,
    roofY: 0.75,
    roofZ: -0.34,
    wingY: 0.82,
    wingZ: -1.44,
    wingWidth: 1.72,
    exhausts: [
      { x: -0.46, y: -0.04, z: -1.70, radius: 0.15 },
      { x: 0.46, y: -0.04, z: -1.70, radius: 0.15 },
    ],
  },
  apex: {
    id: 'apex',
    label: 'Apex Proto',
    tagline: 'Hypercar Le Mans con pinna dorsale',
    bodyWidth: 1.78,
    bodyLength: 3.84,
    chassisHeight: 0.64,
    frontWheelRadius: 0.34,
    rearWheelRadius: 0.36,
    frontTireWidth: 0.30,
    rearTireWidth: 0.36,
    frontAxleZ: 1.24,
    rearAxleZ: -1.16,
    frontTrackHalfWidth: 0.88,
    rearTrackHalfWidth: 0.90,
    roofY: 0.44,
    roofZ: -0.08,
    wingY: 0.64,
    wingZ: -1.68,
    wingWidth: 1.88,
    exhausts: [{ x: 0, y: 0.06, z: -1.84, radius: 0.24 }],
  },
  formula: {
    id: 'formula',
    label: 'Formula X',
    tagline: 'Monoposto a ruote scoperte & halo',
    bodyWidth: 0.92,
    bodyLength: 3.88,
    chassisHeight: 0.72,
    frontWheelRadius: 0.34,
    rearWheelRadius: 0.38,
    frontTireWidth: 0.32,
    rearTireWidth: 0.42,
    frontAxleZ: 1.32,
    rearAxleZ: -1.18,
    frontTrackHalfWidth: 0.94,
    rearTrackHalfWidth: 0.94,
    roofY: 0.56,
    roofZ: -0.22,
    wingY: 0.70,
    wingZ: -1.72,
    wingWidth: 1.86,
    exhausts: [{ x: 0, y: 0.08, z: -1.82, radius: 0.21 }],
  },
  titan: {
    id: 'titan',
    label: 'Titan Rig',
    tagline: 'Pickup Baja blindato con roll-bar',
    bodyWidth: 1.64,
    bodyLength: 3.68,
    chassisHeight: 1.16,
    frontWheelRadius: 0.42,
    rearWheelRadius: 0.42,
    frontTireWidth: 0.36,
    rearTireWidth: 0.36,
    frontAxleZ: 1.16,
    rearAxleZ: -1.14,
    frontTrackHalfWidth: 0.91,
    rearTrackHalfWidth: 0.91,
    roofY: 0.86,
    roofZ: 0.08,
    wingY: 0.94,
    wingZ: -1.62,
    wingWidth: 1.76,
    exhausts: [
      { x: -0.52, y: 0.10, z: -1.78, radius: 0.17 },
      { x: 0.52, y: 0.10, z: -1.78, radius: 0.17 },
    ],
  },
};

export const CAR_BODY_LIST: CarBodySpec[] = Object.values(BODY_GEOMETRY_SPECS);

export function wheelCenterY(radius: number): number {
  return -CAR_RIDE_HEIGHT + radius;
}

export const PAINT_FINISH_OPTIONS: Array<{ id: PaintFinish; label: string }> = [
  { id: 'metallic', label: 'Metallizzata' },
  { id: 'gloss', label: 'Lucida' },
  { id: 'matte', label: 'Opaca' },
  { id: 'anodized', label: 'Anodizzata' },
  { id: 'pearlescent', label: 'Perlescente' },
  { id: 'chrome', label: 'Cromo' },
];

export const DECAL_OPTIONS: Array<{ id: DecalStyle; label: string }> = [
  { id: 'stripes', label: 'Strisce GT' },
  { id: 'flames', label: 'Fiamme' },
  { id: 'cyber', label: 'Circuito' },
  { id: 'wings', label: 'Ali Apex' },
  { id: 'checkers', label: 'Scacchi' },
  { id: 'lightning', label: 'Fulmine' },
  { id: 'carbon_fade', label: 'Carbon Fade' },
  { id: 'clean', label: 'Pulita' },
];

export const WHEEL_OPTIONS: Array<{ id: WheelStyle; label: string; desc: string }> = [
  { id: 'sport', label: 'Sport 5R', desc: '5 razze sdoppiate' },
  { id: 'aero', label: 'Aero Turbo', desc: 'Copridisco racing' },
  { id: 'turbine', label: 'Turbina', desc: '8 pale direzionali' },
  { id: 'cyber', label: 'Cyber Neon', desc: 'Anello LED luminoso' },
  { id: 'star', label: 'Stella Deep', desc: 'Cerchio concavo cromato' },
  { id: 'offroad', label: 'Baja Beadlock', desc: 'Tasselli + anello bulloni' },
];

export const TOPPER_OPTIONS: Array<{ id: TopperStyle; label: string }> = [
  { id: 'none', label: 'Nessuno' },
  { id: 'halo', label: 'Halo Neon' },
  { id: 'crown', label: 'Corona' },
  { id: 'fin', label: 'Pinna Aero' },
  { id: 'horns', label: 'Corna Turbo' },
  { id: 'visor', label: 'Barra Cyber' },
  { id: 'antenna', label: 'Antenna RC' },
];

export const SPOILER_OPTIONS: Array<{ id: SpoilerStyle; label: string }> = [
  { id: 'sport', label: 'Ala Sportiva' },
  { id: 'gt_wing', label: 'Ala GT Carbon' },
  { id: 'twin_blade', label: 'Doppia Lama' },
  { id: 'ducktail', label: 'Ducktail' },
  { id: 'none', label: 'Nessuno' },
];

export const WINDOW_TINT_OPTIONS: Array<{ id: WindowTint; label: string; swatch: string; colorHex: number }> = [
  { id: 'dark', label: 'Fumé Scuro', swatch: '#0f172a', colorHex: 0x0b1220 },
  { id: 'ice', label: 'Ghiaccio', swatch: '#38bdf8', colorHex: 0x0e4f75 },
  { id: 'gold', label: 'Oro', swatch: '#f59e0b', colorHex: 0x6b4707 },
  { id: 'crimson', label: 'Cremisi', swatch: '#e11d48', colorHex: 0x640d23 },
  { id: 'emerald', label: 'Smeraldo', swatch: '#10b981', colorHex: 0x0b4f3a },
];

export const TRIM_OPTIONS: Array<{ id: TrimStyle; label: string }> = [
  { id: 'carbon', label: 'Carbonio' },
  { id: 'chrome', label: 'Cromo' },
  { id: 'body', label: 'Tinta Auto' },
];

export const COLOR_PRESETS = [
  { label: 'Blu Elettrico', value: '#1d4ed8' },
  { label: 'Ciano', value: '#0284c7' },
  { label: 'Arancio Fuoco', value: '#ea580c' },
  { label: 'Rosso Corsa', value: '#dc2626' },
  { label: 'Verde Smeraldo', value: '#059669' },
  { label: 'Viola', value: '#7c3aed' },
  { label: 'Rosa Neon', value: '#db2777' },
  { label: 'Giallo Corsa', value: '#eab308' },
  { label: 'Bianco Perla', value: '#e2e8f0' },
  { label: 'Nero Grafite', value: '#1e293b' },
];

export const ACCENT_PRESETS = [
  { label: 'Celeste', value: '#38bdf8' },
  { label: 'Oro', value: '#fbbf24' },
  { label: 'Bianco', value: '#f8fafc' },
  { label: 'Lime', value: '#84cc16' },
  { label: 'Corallo', value: '#fb7185' },
  { label: 'Viola Plasma', value: '#c084fc' },
  { label: 'Arancio', value: '#fb923c' },
  { label: 'Rosso Laser', value: '#ef4444' },
];

export const BOOST_PRESETS = [
  { label: 'Turbo Blu', value: '#38bdf8' },
  { label: 'Turbo Fuoco', value: '#f97316' },
  { label: 'Turbo Oro', value: '#facc15' },
  { label: 'Turbo Verde', value: '#4ade80' },
  { label: 'Turbo Plasma', value: '#c084fc' },
  { label: 'Turbo Cremisi', value: '#f43f5e' },
  { label: 'Turbo Bianco', value: '#f8fafc' },
];

export const HEADLIGHT_PRESETS = [
  { label: 'LED Bianco Ghiaccio', value: '#e0f2fe' },
  { label: 'Xeno Ciano', value: '#22d3ee' },
  { label: 'Giallo Endurance', value: '#facc15' },
  { label: 'Rosso Demon', value: '#fb7185' },
  { label: 'Viola Laser', value: '#c084fc' },
];

export interface GaragePreset {
  label: string;
  config: CarCustomization;
}

export const GARAGE_PRESETS: GaragePreset[] = [
  {
    label: 'Formula GP',
    config: {
      body: 'formula',
      primaryColor: '#dc2626',
      accentColor: '#f8fafc',
      boostColor: '#fbbf24',
      boostEffect: 'classic_flame',
      decal: 'checkers',
      wheelStyle: 'aero',
      paintFinish: 'gloss',
      topper: 'none',
      underglow: true,
      underglowColor: '#f43f5e',
      wheelColor: '#facc15',
      spoiler: 'gt_wing',
      windowTint: 'gold',
      trimStyle: 'carbon',
      headlightColor: '#facc15',
    },
  },
  {
    label: 'Hyper Apex',
    config: {
      body: 'apex',
      primaryColor: '#0f172a',
      accentColor: '#22d3ee',
      boostColor: '#22d3ee',
      boostEffect: 'neon_cyber',
      decal: 'lightning',
      wheelStyle: 'cyber',
      paintFinish: 'pearlescent',
      topper: 'visor',
      underglow: true,
      underglowColor: '#22d3ee',
      wheelColor: '#22d3ee',
      spoiler: 'twin_blade',
      windowTint: 'ice',
      trimStyle: 'carbon',
      headlightColor: '#22d3ee',
    },
  },
  {
    label: 'Baja Titan',
    config: {
      body: 'titan',
      primaryColor: '#ca8a04',
      accentColor: '#1e293b',
      boostColor: '#38bdf8',
      boostEffect: 'frost_blizzard',
      decal: 'carbon_fade',
      wheelStyle: 'offroad',
      paintFinish: 'matte',
      topper: 'horns',
      underglow: false,
      underglowColor: '#f97316',
      wheelColor: '#f97316',
      spoiler: 'none',
      windowTint: 'gold',
      trimStyle: 'carbon',
      headlightColor: '#fef3c7',
    },
  },
  {
    label: 'Dominus V8',
    config: {
      body: 'dominus',
      primaryColor: '#7c3aed',
      accentColor: '#fbbf24',
      boostColor: '#c084fc',
      boostEffect: 'black_hole',
      decal: 'flames',
      wheelStyle: 'star',
      paintFinish: 'chrome',
      topper: 'crown',
      underglow: true,
      underglowColor: '#c084fc',
      wheelColor: '#fbbf24',
      spoiler: 'ducktail',
      windowTint: 'crimson',
      trimStyle: 'chrome',
      headlightColor: '#e0f2fe',
    },
  },
];

export const BOT_CUSTOMIZATIONS_BLUE: CarCustomization[] = [
  { ...DEFAULT_CUSTOMIZATION_BLUE, body: 'fennec', decal: 'checkers', wheelStyle: 'aero', spoiler: 'sport', boostEffect: 'frost_blizzard' },
  { ...DEFAULT_CUSTOMIZATION_BLUE, body: 'apex', primaryColor: '#0284c7', accentColor: '#f8fafc', decal: 'lightning', wheelStyle: 'cyber', paintFinish: 'pearlescent', underglow: true, boostEffect: 'neon_cyber' },
  { ...DEFAULT_CUSTOMIZATION_BLUE, body: 'formula', primaryColor: '#1e40af', accentColor: '#38bdf8', decal: 'stripes', wheelStyle: 'aero', spoiler: 'gt_wing', paintFinish: 'gloss', boostEffect: 'rainbow_prism' },
  { ...DEFAULT_CUSTOMIZATION_BLUE, body: 'titan', primaryColor: '#0f766e', accentColor: '#99f6e4', decal: 'carbon_fade', wheelStyle: 'offroad', spoiler: 'none', paintFinish: 'matte', boostEffect: 'classic_flame' },
];

export const BOT_CUSTOMIZATIONS_ORANGE: CarCustomization[] = [
  {
    body: 'dominus',
    primaryColor: '#ea580c',
    accentColor: '#fbbf24',
    boostColor: '#f97316',
    boostEffect: 'classic_flame',
    decal: 'flames',
    wheelStyle: 'star',
    paintFinish: 'metallic',
    topper: 'horns',
    underglow: false,
    underglowColor: '#fbbf24',
    wheelColor: '#fbbf24',
    spoiler: 'ducktail',
    windowTint: 'gold',
    trimStyle: 'chrome',
    headlightColor: '#facc15',
  },
  {
    body: 'formula',
    primaryColor: '#dc2626',
    accentColor: '#f8fafc',
    boostColor: '#facc15',
    boostEffect: 'rainbow_prism',
    decal: 'checkers',
    wheelStyle: 'turbine',
    paintFinish: 'gloss',
    topper: 'none',
    underglow: true,
    underglowColor: '#ef4444',
    wheelColor: '#f8fafc',
    spoiler: 'gt_wing',
    windowTint: 'dark',
    trimStyle: 'carbon',
    headlightColor: '#fef3c7',
  },
  {
    body: 'titan',
    primaryColor: '#b45309',
    accentColor: '#fde047',
    boostColor: '#fb923c',
    boostEffect: 'frost_blizzard',
    decal: 'wings',
    wheelStyle: 'offroad',
    paintFinish: 'matte',
    topper: 'antenna',
    underglow: false,
    underglowColor: '#f97316',
    wheelColor: '#fb923c',
    spoiler: 'none',
    windowTint: 'gold',
    trimStyle: 'carbon',
    headlightColor: '#facc15',
  },
  {
    body: 'apex',
    primaryColor: '#be123c',
    accentColor: '#fb7185',
    boostColor: '#c084fc',
    boostEffect: 'black_hole',
    decal: 'cyber',
    wheelStyle: 'cyber',
    paintFinish: 'anodized',
    topper: 'fin',
    underglow: true,
    underglowColor: '#fb7185',
    wheelColor: '#fb7185',
    spoiler: 'twin_blade',
    windowTint: 'crimson',
    trimStyle: 'carbon',
    headlightColor: '#fb7185',
  },
];

const VALID_BODIES = new Set<string>(Object.keys(BODY_GEOMETRY_SPECS));
const VALID_DECALS = new Set<string>(DECAL_OPTIONS.map((d) => d.id));
const VALID_WHEELS = new Set<string>(WHEEL_OPTIONS.map((w) => w.id));
const VALID_FINISHES = new Set<string>(PAINT_FINISH_OPTIONS.map((f) => f.id));
const VALID_TOPPERS = new Set<string>(TOPPER_OPTIONS.map((t) => t.id));
const VALID_SPOILERS = new Set<string>(SPOILER_OPTIONS.map((s) => s.id));
const VALID_TINTS = new Set<string>(WINDOW_TINT_OPTIONS.map((w) => w.id));
const VALID_TRIMS = new Set<string>(TRIM_OPTIONS.map((t) => t.id));

function validHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

export function normalizeCarCustomization(
  raw?: Partial<CarCustomization> | null,
  fallback: CarCustomization = DEFAULT_CUSTOMIZATION_BLUE,
): CarCustomization {
  const src = raw ?? {};
  const accent = validHex(src.accentColor, fallback.accentColor);
  return {
    body: VALID_BODIES.has(String(src.body)) ? (src.body as CarBodyStyle) : fallback.body,
    primaryColor: validHex(src.primaryColor, fallback.primaryColor),
    accentColor: accent,
    boostColor: validHex(src.boostColor, fallback.boostColor),
    boostEffect: isValidBoostEffect(src.boostEffect)
      ? (src.boostEffect as BoostEffectStyle)
      : (fallback.boostEffect ?? 'classic_flame'),
    decal: VALID_DECALS.has(String(src.decal)) ? (src.decal as DecalStyle) : fallback.decal,
    wheelStyle: VALID_WHEELS.has(String(src.wheelStyle))
      ? (src.wheelStyle as WheelStyle)
      : fallback.wheelStyle,
    paintFinish: VALID_FINISHES.has(String(src.paintFinish))
      ? (src.paintFinish as PaintFinish)
      : (fallback.paintFinish ?? 'metallic'),
    topper: VALID_TOPPERS.has(String(src.topper))
      ? (src.topper as TopperStyle)
      : (fallback.topper ?? 'none'),
    underglow: typeof src.underglow === 'boolean' ? src.underglow : Boolean(fallback.underglow),
    underglowColor: validHex(src.underglowColor, accent),
    wheelColor: validHex(src.wheelColor, accent),
    spoiler: VALID_SPOILERS.has(String(src.spoiler))
      ? (src.spoiler as SpoilerStyle)
      : (fallback.spoiler ?? 'sport'),
    windowTint: VALID_TINTS.has(String(src.windowTint))
      ? (src.windowTint as WindowTint)
      : (fallback.windowTint ?? 'dark'),
    trimStyle: VALID_TRIMS.has(String(src.trimStyle))
      ? (src.trimStyle as TrimStyle)
      : (fallback.trimStyle ?? 'carbon'),
    headlightColor: validHex(src.headlightColor, fallback.headlightColor ?? '#e0f2fe'),
  };
}

export function randomizeCarCustomization(rng: () => number = Math.random): CarCustomization {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
  const primary = pick(COLOR_PRESETS).value;
  const accent = pick(ACCENT_PRESETS).value;
  const boost = pick(BOOST_PRESETS).value;
  const body = pick(CAR_BODY_LIST).id;
  const wheelStyle =
    body === 'titan' && rng() < 0.55
      ? 'offroad'
      : body === 'formula' && rng() < 0.55
        ? 'aero'
        : pick(WHEEL_OPTIONS).id;

  return {
    body,
    primaryColor: primary,
    accentColor: accent,
    boostColor: boost,
    boostEffect: pick(BOOST_EFFECT_OPTIONS).id,
    decal: pick(DECAL_OPTIONS).id,
    wheelStyle,
    paintFinish: pick(PAINT_FINISH_OPTIONS).id,
    topper: pick(TOPPER_OPTIONS).id,
    underglow: rng() < 0.65,
    underglowColor: rng() < 0.5 ? accent : boost,
    wheelColor: rng() < 0.65 ? accent : '#f8fafc',
    spoiler: body === 'titan' && rng() < 0.45 ? 'none' : pick(SPOILER_OPTIONS).id,
    windowTint: pick(WINDOW_TINT_OPTIONS).id,
    trimStyle: pick(TRIM_OPTIONS).id,
    headlightColor: pick(HEADLIGHT_PRESETS).value,
  };
}

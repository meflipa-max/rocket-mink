import type { BoostEffectStyle } from './types';

export interface BoostEffectSpec {
  id: BoostEffectStyle;
  label: string;
  desc: string;
  swatchColors: [string, string, string];
  smokeRate: number;
  glowRate: number;
  ringRate: number;
  shardRate: number;
  smokeGravity: number;
  smokeDrag: number;
  smokeSpread: number;
  smokeStartScale: number;
  smokeEndScale: number;
  smokeLife: number;
  smokeMaxAlpha: number;
  glowLife: number;
  glowStartScale: number;
  glowEndScale: number;
  glowMaxAlpha: number;
  ringStartScale: number;
  ringEndScale: number;
  ringLife: number;
  shardLife: number;
  shardScale: number;
  swirlStrength: number;
}

export const BOOST_EFFECT_SPECS: Record<BoostEffectStyle, BoostEffectSpec> = {
  classic_flame: {
    id: 'classic_flame',
    label: 'Fiamma Plasma',
    desc: 'Fumo caldo, fiamme vive e scintille ardenti',
    swatchColors: ['#f97316', '#fde047', '#475569'],
    smokeRate: 38,
    glowRate: 28,
    ringRate: 0,
    shardRate: 18,
    smokeGravity: -1.6, // warm smoke rises slightly
    smokeDrag: 1.7,
    smokeSpread: 1.45,
    smokeStartScale: 0.56,
    smokeEndScale: 2.35,
    smokeLife: 0.72,
    smokeMaxAlpha: 0.66,
    glowLife: 0.28,
    glowStartScale: 0.58,
    glowEndScale: 0.08,
    glowMaxAlpha: 0.48,
    ringStartScale: 0,
    ringEndScale: 0,
    ringLife: 0,
    shardLife: 0.42,
    shardScale: 0.26,
    swirlStrength: 0.7,
  },
  neon_cyber: {
    id: 'neon_cyber',
    label: 'Cyber Pulse',
    desc: 'Anelli laser olografici e scia digitale',
    swatchColors: ['#22d3ee', '#a855f7', '#0f172a'],
    smokeRate: 18,
    glowRate: 22,
    ringRate: 16,
    shardRate: 26,
    smokeGravity: 0,
    smokeDrag: 2.6,
    smokeSpread: 0.65,
    smokeStartScale: 0.36,
    smokeEndScale: 1.35,
    smokeLife: 0.50,
    smokeMaxAlpha: 0.42,
    glowLife: 0.32,
    glowStartScale: 0.46,
    glowEndScale: 0.10,
    glowMaxAlpha: 0.44,
    ringStartScale: 0.36,
    ringEndScale: 1.32,
    ringLife: 0.48,
    shardLife: 0.46,
    shardScale: 0.34,
    swirlStrength: 0.25,
  },
  rainbow_prism: {
    id: 'rainbow_prism',
    label: 'Prisma Astrale',
    desc: 'Nebulosa arcobaleno con stelle luminose',
    swatchColors: ['#f43f5e', '#facc15', '#38bdf8'],
    smokeRate: 40,
    glowRate: 30,
    ringRate: 7,
    shardRate: 26,
    smokeGravity: -0.7,
    smokeDrag: 1.5,
    smokeSpread: 1.35,
    smokeStartScale: 0.54,
    smokeEndScale: 2.25,
    smokeLife: 0.76,
    smokeMaxAlpha: 0.62,
    glowLife: 0.42,
    glowStartScale: 0.54,
    glowEndScale: 0.06,
    glowMaxAlpha: 0.44,
    ringStartScale: 0.30,
    ringEndScale: 1.12,
    ringLife: 0.44,
    shardLife: 0.52,
    shardScale: 0.32,
    swirlStrength: 2.3,
  },
  frost_blizzard: {
    id: 'frost_blizzard',
    label: 'Cryo Glaciale',
    desc: 'Cristalli di ghiaccio e nebbia artica',
    swatchColors: ['#e0f2fe', '#38bdf8', '#0284c7'],
    smokeRate: 46,
    glowRate: 18,
    ringRate: 0,
    shardRate: 42,
    smokeGravity: 1.4, // cold cryo mist settles downward
    smokeDrag: 2.0,
    smokeSpread: 1.85,
    smokeStartScale: 0.60,
    smokeEndScale: 2.65,
    smokeLife: 0.80,
    smokeMaxAlpha: 0.70,
    glowLife: 0.34,
    glowStartScale: 0.46,
    glowEndScale: 0.08,
    glowMaxAlpha: 0.38,
    ringStartScale: 0,
    ringEndScale: 0,
    ringLife: 0,
    shardLife: 0.58,
    shardScale: 0.42,
    swirlStrength: 3.0,
  },
  black_hole: {
    id: 'black_hole',
    label: 'Vuoto Cosmico',
    desc: 'Fumo oscuro con anelli e fulmini viola',
    swatchColors: ['#1e1b4b', '#9333ea', '#f0abfc'],
    smokeRate: 46,
    glowRate: 18,
    ringRate: 14,
    shardRate: 24,
    smokeGravity: -0.25,
    smokeDrag: 2.1,
    smokeSpread: 1.25,
    smokeStartScale: 0.62,
    smokeEndScale: 2.55,
    smokeLife: 0.78,
    smokeMaxAlpha: 0.86,
    glowLife: 0.30,
    glowStartScale: 0.48,
    glowEndScale: 0.04,
    glowMaxAlpha: 0.38,
    ringStartScale: 1.12, // imploding singularity rings!
    ringEndScale: 0.16,
    ringLife: 0.46,
    shardLife: 0.45,
    shardScale: 0.34,
    swirlStrength: 4.0,
  },
};

export const BOOST_EFFECT_OPTIONS: BoostEffectSpec[] = Object.values(BOOST_EFFECT_SPECS);

export function isValidBoostEffect(value: unknown): value is BoostEffectStyle {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BOOST_EFFECT_SPECS, value);
}

export function getBoostEffectSpec(style?: BoostEffectStyle): BoostEffectSpec {
  if (style && isValidBoostEffect(style)) {
    return BOOST_EFFECT_SPECS[style];
  }
  return BOOST_EFFECT_SPECS.classic_flame;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 1) + 1) % 1;
  const sat = clamp01(s);
  const lig = clamp01(l);
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const color = lig - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim().slice(1) : '38bdf8';
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(hexA: string, hexB: string, t: number): string {
  const k = clamp01(t);
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const r = Math.round(r1 + (r2 - r1) * k)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(g1 + (g2 - g1) * k)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(b1 + (b2 - b1) * k)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

export type ParticleRole = 'smoke' | 'glow' | 'ring' | 'shard';

export function sampleBoostParticleColor(
  style: BoostEffectStyle,
  baseHex: string,
  role: ParticleRole,
  elapsed: number,
  seed: number,
): string {
  const s = ((seed % 1) + 1) % 1;
  if (style === 'rainbow_prism') {
    const hue = (elapsed * 0.72 + s * 0.45) % 1;
    if (role === 'smoke') return hslToHex(hue, 0.88, 0.56);
    if (role === 'shard') return hslToHex((hue + 0.22) % 1, 0.96, 0.66);
    return hslToHex(hue, 0.96, role === 'glow' ? 0.60 : 0.58);
  }
  if (style === 'neon_cyber') {
    if (role === 'smoke') return mixHex('#0f172a', baseHex, 0.48);
    if (role === 'ring') return s > 0.45 ? baseHex : mixHex(baseHex, '#d946ef', 0.65);
    if (role === 'shard') return s > 0.35 ? '#a5f3fc' : mixHex(baseHex, '#e879f9', 0.45);
    return mixHex(baseHex, '#e0f2fe', s * 0.45);
  }
  if (style === 'frost_blizzard') {
    if (role === 'smoke') return mixHex('#bae6fd', baseHex, 0.18 + s * 0.18);
    if (role === 'shard') return s > 0.4 ? '#f0f9ff' : mixHex('#38bdf8', baseHex, 0.25);
    return mixHex('#7dd3fc', '#e0f2fe', s * 0.5);
  }
  if (style === 'black_hole') {
    if (role === 'smoke') return s > 0.3 ? '#070412' : '#1b0b36';
    if (role === 'ring') return mixHex('#9333ea', '#e879f9', s * 0.55);
    if (role === 'shard') return s > 0.45 ? '#f0abfc' : '#9333ea';
    return mixHex('#7e22ce', '#e879f9', s * 0.55);
  }
  // classic_flame
  if (role === 'smoke') return mixHex('#334155', baseHex, 0.22 + s * 0.24);
  if (role === 'shard') return mixHex('#fde047', '#f97316', s);
  return mixHex(baseHex, '#fed7aa', 0.18 + s * 0.45);
}

export function computeExhaustPlumeTint(
  style: BoostEffectStyle,
  baseHex: string,
  elapsed: number,
): { outerHex: string; innerHex: string; pulseScale: number } {
  if (style === 'rainbow_prism') {
    const h = (elapsed * 0.72) % 1;
    return {
      outerHex: hslToHex(h, 0.95, 0.56),
      innerHex: hslToHex((h + 0.15) % 1, 1.0, 0.80),
      pulseScale: 0.92 + Math.sin(elapsed * 16) * 0.14,
    };
  }
  if (style === 'neon_cyber') {
    return {
      outerHex: baseHex,
      innerHex: mixHex(baseHex, '#ffffff', 0.68),
      pulseScale: 0.88 + (Math.sin(elapsed * 26) > 0 ? 0.18 : 0.02),
    };
  }
  if (style === 'frost_blizzard') {
    return {
      outerHex: mixHex('#38bdf8', baseHex, 0.35),
      innerHex: '#e0f2fe',
      pulseScale: 0.90 + Math.sin(elapsed * 12) * 0.12,
    };
  }
  if (style === 'black_hole') {
    return {
      outerHex: '#9333ea',
      innerHex: '#130728',
      pulseScale: 0.96 + Math.sin(elapsed * 20) * 0.16,
    };
  }
  // classic_flame
  return {
    outerHex: baseHex,
    innerHex: '#fff7ed',
    pulseScale: 0.86 + Math.sin(elapsed * 18) * 0.18,
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOOST_EFFECT_OPTIONS,
  computeExhaustPlumeTint,
  getBoostEffectSpec,
  isValidBoostEffect,
  sampleBoostParticleColor,
} from './boostEffects';

test('all 5 boost effects exist and have distinct visual/physics signatures', () => {
  assert.equal(BOOST_EFFECT_OPTIONS.length, 5);
  const ids = new Set(BOOST_EFFECT_OPTIONS.map((e) => e.id));
  assert.equal(ids.size, 5);
  for (const spec of BOOST_EFFECT_OPTIONS) {
    assert.ok(spec.label.length > 0);
    assert.ok(spec.desc.length > 0);
    assert.equal(spec.swatchColors.length, 3);
    assert.ok(spec.smokeRate > 0);
    assert.ok(spec.glowRate > 0);
    assert.ok(spec.smokeLife > 0.2);
  }
});

test('isValidBoostEffect and getBoostEffectSpec sanitize unknown values', () => {
  assert.equal(isValidBoostEffect('neon_cyber'), true);
  assert.equal(isValidBoostEffect('rainbow_prism'), true);
  assert.equal(isValidBoostEffect('frost_blizzard'), true);
  assert.equal(isValidBoostEffect('black_hole'), true);
  assert.equal(isValidBoostEffect('classic_flame'), true);
  assert.equal(isValidBoostEffect('invalid_smoke'), false);
  assert.equal(getBoostEffectSpec('invalid_smoke' as never).id, 'classic_flame');
});

test('sampleBoostParticleColor emits valid hex colors and rainbow cycles hue over time', () => {
  for (const spec of BOOST_EFFECT_OPTIONS) {
    for (const role of ['smoke', 'glow', 'ring', 'shard'] as const) {
      const hex = sampleBoostParticleColor(spec.id, '#38bdf8', role, 1.25, 0.42);
      assert.match(hex, /^#[0-9a-f]{6}$/i);
    }
  }

  const r0 = sampleBoostParticleColor('rainbow_prism', '#38bdf8', 'glow', 0.0, 0.1);
  const r1 = sampleBoostParticleColor('rainbow_prism', '#38bdf8', 'glow', 0.4, 0.1);
  assert.notEqual(r0, r1);
});

test('computeExhaustPlumeTint returns valid hexes and positive pulse scale for all effects', () => {
  for (const spec of BOOST_EFFECT_OPTIONS) {
    const tint = computeExhaustPlumeTint(spec.id, '#f97316', 2.3);
    assert.match(tint.outerHex, /^#[0-9a-f]{6}$/i);
    assert.match(tint.innerHex, /^#[0-9a-f]{6}$/i);
    assert.ok(tint.pulseScale > 0.5 && tint.pulseScale < 2.0);
  }
});

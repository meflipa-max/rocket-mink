import assert from 'node:assert/strict';
import test from 'node:test';
import { CAR_RIDE_HEIGHT } from './arena';
import {
  BODY_GEOMETRY_SPECS,
  CAR_BODY_LIST,
  GARAGE_PRESETS,
  normalizeCarCustomization,
  randomizeCarCustomization,
  wheelCenterY,
} from './customization';
import { DEFAULT_CUSTOMIZATION_BLUE } from './types';

test('all 6 car body styles have meaningfully distinct silhouette dimensions', () => {
  assert.equal(CAR_BODY_LIST.length, 6);

  // Pairwise check: every pair of bodies must differ meaningfully in multiple geometric dimensions
  for (let i = 0; i < CAR_BODY_LIST.length; i++) {
    for (let j = i + 1; j < CAR_BODY_LIST.length; j++) {
      const a = CAR_BODY_LIST[i];
      const b = CAR_BODY_LIST[j];
      const diffs = [
        Math.abs(a.bodyWidth - b.bodyWidth) >= 0.14,
        Math.abs(a.bodyLength - b.bodyLength) >= 0.14,
        Math.abs(a.chassisHeight - b.chassisHeight) >= 0.12,
        Math.abs(a.roofY - b.roofY) >= 0.08,
        Math.abs(a.frontWheelRadius - b.frontWheelRadius) >= 0.03,
        Math.abs(a.rearTireWidth - b.rearTireWidth) >= 0.04,
        a.exhausts.length !== b.exhausts.length,
      ].filter(Boolean).length;

      assert.ok(
        diffs >= 2,
        `Bodies ${a.id} and ${b.id} must differ across at least 2 major dimensions (got ${diffs})`,
      );
    }
  }
});

test('every body wheel center rests its tire bottom cleanly on ground plane', () => {
  for (const spec of CAR_BODY_LIST) {
    const frontBottom = wheelCenterY(spec.frontWheelRadius) - spec.frontWheelRadius;
    const rearBottom = wheelCenterY(spec.rearWheelRadius) - spec.rearWheelRadius;
    assert.ok(Math.abs(frontBottom + CAR_RIDE_HEIGHT) < 1e-6);
    assert.ok(Math.abs(rearBottom + CAR_RIDE_HEIGHT) < 1e-6);
    assert.ok(spec.frontAxleZ > 1.0 && spec.rearAxleZ < -1.0);
    assert.ok(spec.exhausts.length >= 1);
  }
});

test('normalizeCarCustomization preserves legacy configs and sanitizes invalid values', () => {
  const legacy = {
    body: 'octane' as const,
    primaryColor: '#123456',
    accentColor: '#abcdef',
    boostColor: '#ff00aa',
    decal: 'flames' as const,
    wheelStyle: 'cyber' as const,
  };
  const normalized = normalizeCarCustomization(legacy);
  assert.equal(normalized.body, 'octane');
  assert.equal(normalized.primaryColor, '#123456');
  assert.equal(normalized.underglowColor, '#abcdef');
  assert.equal(normalized.wheelColor, '#abcdef');
  assert.equal(normalized.windowTint, 'dark');
  assert.equal(normalized.trimStyle, 'carbon');

  const corrupt = normalizeCarCustomization({
    body: 'unknown_car' as never,
    primaryColor: 'not-a-hex',
    spoiler: 'giant' as never,
  });
  assert.equal(corrupt.body, DEFAULT_CUSTOMIZATION_BLUE.body);
  assert.equal(corrupt.primaryColor, DEFAULT_CUSTOMIZATION_BLUE.primaryColor);
  assert.equal(corrupt.spoiler, DEFAULT_CUSTOMIZATION_BLUE.spoiler);
});

test('presets and randomizer always emit valid normalized configurations', () => {
  for (const preset of GARAGE_PRESETS) {
    assert.ok(BODY_GEOMETRY_SPECS[preset.config.body]);
    const roundtrip = normalizeCarCustomization(preset.config);
    assert.deepEqual(roundtrip, preset.config);
  }

  let seed = 42;
  const deterministicRng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 20; i++) {
    const rand = randomizeCarCustomization(deterministicRng);
    assert.ok(BODY_GEOMETRY_SPECS[rand.body]);
    assert.deepEqual(normalizeCarCustomization(rand), rand);
  }
});

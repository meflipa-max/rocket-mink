import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomCode, normalizeRoomCodeInput, pickBalancedTeam } from './roomHelpers';

test('normalizeRoomCodeInput handles 6-char, 8-char codes, spaces, and full invite URLs', () => {
  assert.equal(normalizeRoomCodeInput('51690148'), '51690148');
  assert.equal(normalizeRoomCodeInput('  a4k9p2  '), 'A4K9P2');
  assert.equal(
    normalizeRoomCodeInput('https://rocket-mink.vercel.app/?room=51690148'),
    '51690148',
  );
  assert.equal(normalizeRoomCodeInput('?room=abc12345&foo=bar'), 'ABC12345');
  assert.equal(normalizeRoomCodeInput(''), '');
});

test('generateRoomCode returns unambiguous uppercase alphanumeric code', () => {
  const code = generateRoomCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z2-9]{6}$/);
});

test('pickBalancedTeam balances blue and orange teams', () => {
  assert.equal(pickBalancedTeam([]), 'blue');
  assert.equal(pickBalancedTeam([{ team: 'blue' }]), 'orange');
  assert.equal(pickBalancedTeam([{ team: 'blue' }, { team: 'orange' }]), 'blue');
  assert.equal(
    pickBalancedTeam([{ team: 'blue' }, { team: 'orange' }, { team: 'orange' }]),
    'blue',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAcceptRoomRequest,
  findStalePlayerIds,
  generateRoomCode,
  normalizeRoomCodeInput,
  pickBalancedTeam,
} from './roomHelpers';

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

test('findStalePlayerIds and canAcceptRoomRequest allow rejoin and evict silent ghosts', () => {
  const players = [
    { id: 'host-1', isHost: true },
    { id: 'guest-1', isHost: false },
  ];
  const lastSeen = new Map<string, number>([['guest-1', 1000]]);

  // Active 1v1 room rejects third distinct player while guest-1 heartbeat is fresh
  const staleAt4s = findStalePlayerIds(players, lastSeen, 4000, 8500);
  assert.deepEqual(staleAt4s, []);
  assert.equal(canAcceptRoomRequest(players, 2, 'guest-2', staleAt4s), false);

  // Returning player with same ID is always allowed back in even when maxPlayers === 2
  assert.equal(canAcceptRoomRequest(players, 2, 'guest-1', staleAt4s), true);

  // Once guest-1 goes silent past timeout, slot becomes reclaimable for a fresh rejoin ID
  const staleAt10s = findStalePlayerIds(players, lastSeen, 10000, 8500);
  assert.deepEqual(staleAt10s, ['guest-1']);
  assert.equal(canAcceptRoomRequest(players, 2, 'guest-2', staleAt10s), true);
});

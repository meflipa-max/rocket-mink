import type { Team } from './types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Extracts and normalizes a room code from either a raw code (6 or 8+ chars)
 * or a pasted invite URL such as `https://rocket-mink.vercel.app/?room=51690148`.
 */
export function normalizeRoomCodeInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  let candidate = trimmed;
  if (trimmed.includes('room=')) {
    try {
      const asUrl = new URL(trimmed.startsWith('http') ? trimmed : `https://example.invalid/?${trimmed.replace(/^\?/, '')}`);
      const param = asUrl.searchParams.get('room');
      if (param) candidate = param;
    } catch {
      const match = trimmed.match(/[?&]?room=([a-zA-Z0-9_-]+)/i);
      if (match?.[1]) candidate = match[1];
    }
  }

  return candidate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
}

/** Generates a 6-character unambiguous room code. */
export function generateRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Picks the team with fewer current players (preferring blue on ties). */
export function pickBalancedTeam(players: ReadonlyArray<{ team: Team }>): Team {
  let blue = 0;
  let orange = 0;
  for (const p of players) {
    if (p.team === 'blue') blue++;
    else orange++;
  }
  return blue <= orange ? 'blue' : 'orange';
}

export const PEER_HEARTBEAT_TIMEOUT_MS = 8500;

/** Finds non-host players whose heartbeat/traffic timestamp has expired. */
export function findStalePlayerIds(
  players: ReadonlyArray<{ id: string; isHost?: boolean }>,
  lastSeenById: ReadonlyMap<string, number>,
  nowMs: number,
  timeoutMs = PEER_HEARTBEAT_TIMEOUT_MS,
): string[] {
  const stale: string[] = [];
  for (const player of players) {
    if (player.isHost) continue;
    const seenAt = lastSeenById.get(player.id);
    if (seenAt === undefined || nowMs - seenAt > timeoutMs) {
      stale.push(player.id);
    }
  }
  return stale;
}

/**
 * Checks whether a join/reconnect request can enter the room.
 * Existing players in the room are always allowed to reconnect (even at maxPlayers),
 * and any stale/timed-out slots are discounted before rejecting as full.
 */
export function canAcceptRoomRequest(
  players: ReadonlyArray<{ id: string; isHost?: boolean }>,
  maxPlayers: number,
  requesterId: string,
  staleIds: ReadonlyArray<string>,
): boolean {
  if (players.some((p) => p.id === requesterId)) return true;
  const staleSet = new Set(staleIds);
  const activeCount = players.filter((p) => !staleSet.has(p.id)).length;
  return activeCount < maxPlayers;
}

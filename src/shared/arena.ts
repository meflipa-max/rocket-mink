import type { BoostPadState, Team, Vec3 } from './types';
import { clamp, normV3 } from './math3d';

// Spacious Rocket League-inspired arena proportions (in meters)
export const ARENA_HALF_X = 62.0; // Total width = 124m
export const ARENA_HALF_Z = 84.0; // Total length = 168m
export const ARENA_HEIGHT = 26.0; // Ceiling height
export const CORNER_CHAMFER = 12.0; // Compact corners leave longer flat walls
export const RAMP_RADIUS = 4.0; // Floor-to-wall curve
export const CEILING_RAMP_RADIUS = 3.0; // Tighter upper curve and a broad flat ceiling
export const GOAL_HALF_X = 11.5; // Goal width = 23m
export const GOAL_HEIGHT = 7.8; // Goal height = 7.8m
export const GOAL_DEPTH = 10.5; // Goal net depth
export const BALL_RADIUS = 1.65; // Classic oversized Rocket League soccer ball
export const CAR_HALF_EXTENTS: Vec3 = { x: 1.05, y: 0.45, z: 1.75 };
export const CAR_RIDE_HEIGHT = 0.56;

export interface SurfaceHit {
  hit: boolean;
  normal: Vec3; // Inward normal pointing toward arena interior
  penetration: number;
  isFloorOrRamp: boolean;
}

/**
 * Signed distance & inward normal against the Rocket League stadium shell:
 * - Flat pitch floor + smooth curved floor-to-wall ramps
 * - Side walls (X), end backboards (Z), 45-degree corner chamfers
 * - Recessed Blue (-Z) and Orange (+Z) goals with posts, crossbar, back & side nets
 * - Ceiling with curved upper transition
 */
export function resolveArenaSphere(pos: Vec3, radius: number): SurfaceHit {
  let maxPen = 0;
  let bestNormal: Vec3 = { x: 0, y: 1, z: 0 };
  let isFloorOrRamp = false;

  const inGoalMouthX = Math.abs(pos.x) < GOAL_HALF_X - radius * 0.15;
  const inGoalMouthY = pos.y < GOAL_HEIGHT - radius * 0.15;
  const insideGoalArea =
    Math.abs(pos.z) > ARENA_HALF_Z - 0.5 &&
    Math.abs(pos.x) < GOAL_HALF_X + 0.5 &&
    pos.y < GOAL_HEIGHT + 0.5;

  // 1. Inside Goal Chamber bounds
  if (insideGoalArea && Math.abs(pos.z) >= ARENA_HALF_Z) {
    // Floor inside goal
    if (pos.y < radius) {
      const pen = radius - pos.y;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: 0, y: 1, z: 0 };
        isFloorOrRamp = true;
      }
    }
    // Goal roof
    if (pos.y > GOAL_HEIGHT - radius) {
      const pen = pos.y - (GOAL_HEIGHT - radius);
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: 0, y: -1, z: 0 };
      }
    }
    // Goal side walls
    if (pos.x > GOAL_HALF_X - radius) {
      const pen = pos.x - (GOAL_HALF_X - radius);
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: -1, y: 0, z: 0 };
      }
    }
    if (pos.x < -GOAL_HALF_X + radius) {
      const pen = -GOAL_HALF_X + radius - pos.x;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: 1, y: 0, z: 0 };
      }
    }
    // Goal back net
    const maxZ = ARENA_HALF_Z + GOAL_DEPTH;
    if (pos.z > maxZ - radius) {
      const pen = pos.z - (maxZ - radius);
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: 0, y: 0, z: -1 };
      }
    }
    if (pos.z < -maxZ + radius) {
      const pen = -maxZ + radius - pos.z;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: 0, y: 0, z: 1 };
      }
    }
    return {
      hit: maxPen > 0,
      normal: bestNormal,
      penetration: maxPen,
      isFloorOrRamp,
    };
  }

  // 2. Compute horizontal inward distance to the octagonal stadium perimeter
  // Perimeter consists of X = ±ARENA_HALF_X, Z = ±ARENA_HALF_Z, and 45-deg corners:
  // |x| + |z| <= (ARENA_HALF_X + ARENA_HALF_Z - CORNER_CHAMFER)
  const cornerSumLimit = ARENA_HALF_X + ARENA_HALF_Z - CORNER_CHAMFER;
  const invSqrt2 = Math.SQRT1_2;

  const distRight = ARENA_HALF_X - pos.x;
  const distLeft = pos.x + ARENA_HALF_X;
  const distFront = ARENA_HALF_Z - pos.z; // Orange end (+Z)
  const distBack = pos.z + ARENA_HALF_Z; // Blue end (-Z)
  const distCorner = (cornerSumLimit - (Math.abs(pos.x) + Math.abs(pos.z))) * invSqrt2;

  // Determine closest horizontal boundary & its inward normal
  let minWallDist = distRight;
  let wallNormal: Vec3 = { x: -1, y: 0, z: 0 };

  if (distLeft < minWallDist) {
    minWallDist = distLeft;
    wallNormal = { x: 1, y: 0, z: 0 };
  }
  if (distFront < minWallDist) {
    minWallDist = distFront;
    wallNormal = { x: 0, y: 0, z: -1 };
  }
  if (distBack < minWallDist) {
    minWallDist = distBack;
    wallNormal = { x: 0, y: 0, z: 1 };
  }
  if (distCorner < minWallDist) {
    minWallDist = distCorner;
    wallNormal = {
      x: pos.x >= 0 ? -invSqrt2 : invSqrt2,
      y: 0,
      z: pos.z >= 0 ? -invSqrt2 : invSqrt2,
    };
  }

  // If the entity is lined up with the open goal mouth on Z-ends, don't collide with the back wall!
  const isEndWall = Math.abs(wallNormal.z) > 0.9;
  const skipBackWallForGoal = isEndWall && inGoalMouthX && inGoalMouthY;

  // 3. Curved Floor-to-Wall Ramp (when near a wall and near ground, except right inside goal mouth)
  if (!skipBackWallForGoal && minWallDist < RAMP_RADIUS && pos.y < RAMP_RADIUS) {
    const dx = RAMP_RADIUS - minWallDist;
    const dy = RAMP_RADIUS - pos.y;
    const distToFilletCenter = Math.sqrt(dx * dx + dy * dy);
    const maxAllowed = RAMP_RADIUS - radius;
    if (distToFilletCenter > maxAllowed) {
      const pen = distToFilletCenter - maxAllowed;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = normV3({
          x: wallNormal.x * dx,
          y: dy,
          z: wallNormal.z * dx,
        });
        isFloorOrRamp = true;
      }
    }
  } else {
    // Standard floor
    if (pos.y < radius) {
      const pen = radius - pos.y;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = { x: 0, y: 1, z: 0 };
        isFloorOrRamp = true;
      }
    }
    // Standard side/back/corner walls
    if (!skipBackWallForGoal && minWallDist < radius) {
      const pen = radius - minWallDist;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = wallNormal;
        isFloorOrRamp = true;
      }
    }
  }

  // 4. Curved Ceiling-to-Wall transition & flat Ceiling
  if (minWallDist < CEILING_RAMP_RADIUS && pos.y > ARENA_HEIGHT - CEILING_RAMP_RADIUS) {
    const dx = CEILING_RAMP_RADIUS - minWallDist;
    const dy = pos.y - (ARENA_HEIGHT - CEILING_RAMP_RADIUS);
    const distToFilletCenter = Math.sqrt(dx * dx + dy * dy);
    const maxAllowed = CEILING_RAMP_RADIUS - radius;
    if (distToFilletCenter > maxAllowed) {
      const pen = distToFilletCenter - maxAllowed;
      if (pen > maxPen) {
        maxPen = pen;
        bestNormal = normV3({
          x: wallNormal.x * dx,
          y: -dy,
          z: wallNormal.z * dx,
        });
        isFloorOrRamp = true;
      }
    }
  } else if (pos.y > ARENA_HEIGHT - radius) {
    const pen = pos.y - (ARENA_HEIGHT - radius);
    if (pen > maxPen) {
      maxPen = pen;
      bestNormal = { x: 0, y: -1, z: 0 };
      isFloorOrRamp = true;
    }
  }

  // 5. Goalpost & Crossbar rounded rim collision at Z = ±ARENA_HALF_Z
  if (Math.abs(pos.z) > ARENA_HALF_Z - radius - 0.6 && Math.abs(pos.z) < ARENA_HALF_Z + radius + 0.6) {
    const zSign = pos.z >= 0 ? 1 : -1;
    const wallZ = zSign * ARENA_HALF_Z;
    // Left/Right posts
    for (const postX of [-GOAL_HALF_X, GOAL_HALF_X]) {
      const clampedY = clamp(pos.y, 0, GOAL_HEIGHT);
      const dx = pos.x - postX;
      const dy = pos.y - clampedY;
      const dz = pos.z - wallZ;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const minD = radius + 0.25;
      if (d < minD && d > 1e-5) {
        const pen = minD - d;
        if (pen > maxPen) {
          maxPen = pen;
          bestNormal = normV3({ x: dx, y: dy, z: dz });
        }
      }
    }
    // Top crossbar
    if (Math.abs(pos.x) <= GOAL_HALF_X) {
      const dy = pos.y - GOAL_HEIGHT;
      const dz = pos.z - wallZ;
      const d = Math.sqrt(dy * dy + dz * dz);
      const minD = radius + 0.25;
      if (d < minD && d > 1e-5) {
        const pen = minD - d;
        if (pen > maxPen) {
          maxPen = pen;
          bestNormal = normV3({ x: 0, y: dy, z: dz });
        }
      }
    }
  }

  return {
    hit: maxPen > 0,
    normal: bestNormal,
    penetration: maxPen,
    isFloorOrRamp,
  };
}

/**
 * Generates the authentic 34 Rocket League boost pads (6 large 100-boost orbs + 28 small 12-boost pads).
 */
export function createBoostPads(): BoostPadState[] {
  const pads: BoostPadState[] = [];
  let id = 0;

  // 6 Big Boost Orbs (100 boost, 10s respawn)
  const bigCoords: Array<[number, number]> = [
    [-50.0, -68.0],
    [50.0, -68.0],
    [-50.0, 68.0],
    [50.0, 68.0],
    [-55.0, 0],
    [55.0, 0],
  ];
  for (const [x, z] of bigCoords) {
    pads.push({ id: id++, pos: { x, y: 0.9, z }, isBig: true, active: true, respawnTimer: 0 });
  }

  // 28 Small Boost Pads (12 boost, 4s respawn)
  const smallCoords: Array<[number, number]> = [
    // Center line
    [-24, 0],
    [24, 0],
    // Blue half (-Z)
    [0, -20],
    [-16, -26],
    [16, -26],
    [-38, -32],
    [38, -32],
    [-26, -48],
    [26, -48],
    [0, -50],
    [-15, -64],
    [15, -64],
    [0, -72],
    [-34, -68],
    [34, -68],
    // Orange half (+Z)
    [0, 20],
    [-16, 26],
    [16, 26],
    [-38, 32],
    [38, 32],
    [-26, 48],
    [26, 48],
    [0, 50],
    [-15, 64],
    [15, 64],
    [0, 72],
    [-34, 68],
    [34, 68],
  ];

  for (const [x, z] of smallCoords) {
    pads.push({ id: id++, pos: { x, y: 0.3, z }, isBig: false, active: true, respawnTimer: 0 });
  }

  return pads;
}

export interface KickoffSlot {
  pos: Vec3;
  yaw: number;
}

/**
 * Standard Rocket League kickoff spawn slots (diagonal, off-center, center-back).
 * Blue defends -Z (faces +Z, yaw = 0). Orange defends +Z (faces -Z, yaw = PI).
 */
export function getKickoffSpawn(team: Team, slotIndex: number): KickoffSlot {
  const blueSlots: KickoffSlot[] = [
    { pos: { x: -28, y: CAR_RIDE_HEIGHT, z: -38 }, yaw: Math.atan2(28, 38) }, // Left diagonal
    { pos: { x: 28, y: CAR_RIDE_HEIGHT, z: -38 }, yaw: Math.atan2(-28, 38) }, // Right diagonal
    { pos: { x: 0, y: CAR_RIDE_HEIGHT, z: -64 }, yaw: 0 }, // Center goalie
    { pos: { x: -7, y: CAR_RIDE_HEIGHT, z: -56 }, yaw: 0.08 }, // Left back
    { pos: { x: 7, y: CAR_RIDE_HEIGHT, z: -56 }, yaw: -0.08 }, // Right back
  ];

  const slot = blueSlots[slotIndex % blueSlots.length];
  if (team === 'blue') {
    return slot;
  }
  return {
    pos: { x: -slot.pos.x, y: slot.pos.y, z: -slot.pos.z },
    yaw: slot.yaw + Math.PI,
  };
}

export function checkGoalScored(ballPos: Vec3, ballRadius: number): Team | null {
  if (Math.abs(ballPos.x) > GOAL_HALF_X || ballPos.y > GOAL_HEIGHT) {
    return null;
  }
  // Ball crosses completely past Blue goal line (-Z) -> Orange scores!
  if (ballPos.z < -(ARENA_HALF_Z + ballRadius * 0.45)) {
    return 'orange';
  }
  // Ball crosses completely past Orange goal line (+Z) -> Blue scores!
  if (ballPos.z > ARENA_HALF_Z + ballRadius * 0.45) {
    return 'blue';
  }
  return null;
}

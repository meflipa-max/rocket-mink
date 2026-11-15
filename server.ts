import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { createMatchState, NEUTRAL_INPUT, stepSimulation, type PlayerSeed } from './src/shared/physics';
import type {
  ArenaId,
  CarCustomization,
  GameStateSnapshot,
  LobbyPlayer,
  MatchMode,
  PlayerInput,
  QuickChatEvent,
  RoomDetail,
  RoomSummary,
  Team,
} from './src/shared/types';
import { DEFAULT_CUSTOMIZATION_BLUE, DEFAULT_CUSTOMIZATION_ORANGE } from './src/shared/types';
import {
  BOT_CUSTOMIZATIONS_BLUE,
  BOT_CUSTOMIZATIONS_ORANGE,
  normalizeCarCustomization,
} from './src/shared/customization';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface Room {
  code: string;
  name: string;
  mode: MatchMode;
  arenaId: ArenaId;
  hostId: string;
  fillBots: boolean;
  players: Map<string, LobbyPlayer>;
  inputs: Map<string, PlayerInput>;
  gameState: GameStateSnapshot | null;
  tickInterval: NodeJS.Timeout | null;
  lastTickMs: number;
  broadcastCounter: number;
}

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

function maxPlayersForMode(mode: MatchMode): number {
  if (mode === '1v1') return 2;
  if (mode === '2v2') return 4;
  if (mode === '3v3') return 6;
  return 4;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function toRoomSummary(room: Room): RoomSummary {
  return {
    code: room.code,
    name: room.name,
    mode: room.mode,
    arenaId: room.arenaId,
    playerCount: room.players.size,
    maxPlayers: maxPlayersForMode(room.mode),
    inProgress: room.gameState !== null && room.gameState.phase !== 'ended',
    fillBots: room.fillBots,
  };
}

function toRoomDetail(room: Room): RoomDetail {
  return {
    ...toRoomSummary(room),
    hostId: room.hostId,
    players: Array.from(room.players.values()),
  };
}

function pickBalancedTeam(room: Room): Team {
  let blue = 0;
  let orange = 0;
  for (const p of room.players.values()) {
    if (p.team === 'blue') blue++;
    else orange++;
  }
  return blue <= orange ? 'blue' : 'orange';
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, 18);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeInput(raw: unknown): PlayerInput {
  if (!raw || typeof raw !== 'object') return { ...NEUTRAL_INPUT };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  return {
    throttle: num(r.throttle),
    steer: num(r.steer),
    boost: Boolean(r.boost),
    handbrake: Boolean(r.handbrake),
    jump: Boolean(r.jump),
    pitch: num(r.pitch),
    yaw: num(r.yaw),
    roll: num(r.roll),
  };
}

const BOT_NAMES = ['Maverick', 'Vortex', 'Cobra', 'Apex', 'Falcon', 'Nova'];

function buildMatchSeeds(room: Room): PlayerSeed[] {
  const seeds: PlayerSeed[] = [];
  for (const p of room.players.values()) {
    seeds.push({
      id: p.id,
      name: p.name,
      team: p.team,
      isBot: false,
      customization: p.customization,
    });
  }

  if (room.fillBots && room.mode !== 'freeplay') {
    const perTeam = maxPlayersForMode(room.mode) / 2;
    let blueCount = seeds.filter((s) => s.team === 'blue').length;
    let orangeCount = seeds.filter((s) => s.team === 'orange').length;
    let botIdx = 0;

    while (blueCount < perTeam) {
      const name = `${BOT_NAMES[botIdx % BOT_NAMES.length]} [BOT]`;
      const preset = BOT_CUSTOMIZATIONS_BLUE[botIdx % BOT_CUSTOMIZATIONS_BLUE.length];
      seeds.push({
        id: `bot-blue-${botIdx++}`,
        name,
        team: 'blue',
        isBot: true,
        customization: { ...preset },
      });
      blueCount++;
    }
    while (orangeCount < perTeam) {
      const name = `${BOT_NAMES[botIdx % BOT_NAMES.length]} [BOT]`;
      const preset = BOT_CUSTOMIZATIONS_ORANGE[botIdx % BOT_CUSTOMIZATIONS_ORANGE.length];
      seeds.push({
        id: `bot-orange-${botIdx++}`,
        name,
        team: 'orange',
        isBot: true,
        customization: { ...preset },
      });
      orangeCount++;
    }
  }

  return seeds;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });

  app.use(express.json());
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(rooms.values()).map(toRoomSummary);
    res.json(list);
  });

  function broadcastRoomsList() {
    const list = Array.from(rooms.values()).map(toRoomSummary);
    io.emit('rooms:update', list);
  }

  function startRoomMatch(room: Room) {
    if (room.tickInterval) {
      clearInterval(room.tickInterval);
      room.tickInterval = null;
    }

    const seeds = buildMatchSeeds(room);
    room.gameState = createMatchState(room.mode, room.arenaId, seeds);
    room.lastTickMs = Date.now();
    room.broadcastCounter = 0;

    io.to(room.code).emit('match:started', room.gameState);

    // 60Hz authoritative server physics loop, 30Hz state broadcast
    room.tickInterval = setInterval(() => {
      if (!room.gameState) return;
      const now = Date.now();
      const dt = Math.min((now - room.lastTickMs) / 1000, 0.05);
      room.lastTickMs = now;

      const inputRecord: Record<string, PlayerInput> = {};
      for (const [id, inp] of room.inputs.entries()) {
        inputRecord[id] = inp;
      }

      const events = stepSimulation(room.gameState, inputRecord, dt > 0 ? dt : 1 / 60);
      if (events.length > 0) {
        io.to(room.code).emit('game:events', events);
      }

      room.broadcastCounter++;
      if (room.broadcastCounter % 2 === 0 || events.length > 0) {
        io.to(room.code).emit('game:state', room.gameState);
      }
    }, 1000 / 60);

    broadcastRoomsList();
  }

  function leaveCurrentRoom(socket: Socket) {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    socketToRoom.delete(socket.id);
    socket.leave(code);

    const room = rooms.get(code);
    if (!room) return;

    room.players.delete(socket.id);
    room.inputs.delete(socket.id);

    if (room.players.size === 0) {
      if (room.tickInterval) clearInterval(room.tickInterval);
      rooms.delete(code);
      broadcastRoomsList();
      return;
    }

    // Reassign host if needed
    if (room.hostId === socket.id) {
      const nextHost = room.players.values().next().value;
      if (nextHost) {
        room.hostId = nextHost.id;
        nextHost.isHost = true;
      }
    }

    // Remove player's car if match in progress (or convert to bot)
    if (room.gameState) {
      const car = room.gameState.cars.find((c) => c.id === socket.id);
      if (car) {
        car.isBot = true;
        car.name = `${car.name} [BOT]`;
      }
    }

    io.to(code).emit('room:updated', toRoomDetail(room));
    broadcastRoomsList();
  }

  io.on('connection', (socket) => {
    socket.emit('rooms:update', Array.from(rooms.values()).map(toRoomSummary));

    socket.on('rooms:list', () => {
      socket.emit('rooms:update', Array.from(rooms.values()).map(toRoomSummary));
    });

    socket.on(
      'room:create',
      (payload: {
        playerName?: string;
        roomName?: string;
        mode?: MatchMode;
        arenaId?: ArenaId;
        fillBots?: boolean;
        customization?: CarCustomization;
      }) => {
        leaveCurrentRoom(socket);
        const code = generateRoomCode();
        const mode: MatchMode = payload?.mode || '1v1';
        const arenaId: ArenaId = payload?.arenaId || 'dfh_night';
        const playerName = sanitizeName(payload?.playerName, 'Pilota');
        const roomName = sanitizeName(payload?.roomName, `Arena di ${playerName}`);
        const fillBots = payload?.fillBots !== false;

        const room: Room = {
          code,
          name: roomName,
          mode,
          arenaId,
          hostId: socket.id,
          fillBots,
          players: new Map(),
          inputs: new Map(),
          gameState: null,
          tickInterval: null,
          lastTickMs: Date.now(),
          broadcastCounter: 0,
        };

        const player: LobbyPlayer = {
          id: socket.id,
          name: playerName,
          team: 'blue',
          ready: true,
          isHost: true,
          customization: payload?.customization || { ...DEFAULT_CUSTOMIZATION_BLUE },
        };

        room.players.set(socket.id, player);
        rooms.set(code, room);
        socketToRoom.set(socket.id, code);
        socket.join(code);

        socket.emit('room:joined', toRoomDetail(room));
        broadcastRoomsList();
      },
    );

    socket.on(
      'room:join',
      (payload: {
        code: string;
        playerName?: string;
        customization?: CarCustomization;
      }) => {
        const code = String(payload?.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          socket.emit('room:error', 'Stanza non trovata. Controlla il codice.');
          return;
        }
        if (socketToRoom.get(socket.id) === code) {
          socket.emit('room:joined', toRoomDetail(room));
          return;
        }
        const max = maxPlayersForMode(room.mode);
        if (room.players.size >= max) {
          socket.emit('room:error', 'La stanza è al completo.');
          return;
        }

        leaveCurrentRoom(socket);

        const team = pickBalancedTeam(room);
        const playerName = sanitizeName(payload?.playerName, 'Pilota');
        const player: LobbyPlayer = {
          id: socket.id,
          name: playerName,
          team,
          ready: true,
          isHost: false,
          customization:
            payload?.customization ||
            (team === 'blue'
              ? { ...DEFAULT_CUSTOMIZATION_BLUE }
              : { ...DEFAULT_CUSTOMIZATION_ORANGE }),
        };

        room.players.set(socket.id, player);
        socketToRoom.set(socket.id, code);
        socket.join(code);

        // If match is already active, replace a bot on that team or hot-join!
        if (room.gameState) {
          const botSlot = room.gameState.cars.find((c) => c.isBot && c.team === team);
          if (botSlot) {
            botSlot.id = socket.id;
            botSlot.name = playerName;
            botSlot.isBot = false;
            botSlot.customization = player.customization;
          }
          socket.emit('match:started', room.gameState);
        }

        socket.emit('room:joined', toRoomDetail(room));
        io.to(code).emit('room:updated', toRoomDetail(room));
        broadcastRoomsList();
      },
    );

    socket.on(
      'matchmaking:quick',
      (payload: {
        playerName?: string;
        mode?: MatchMode;
        customization?: CarCustomization;
      }) => {
        const mode: MatchMode = payload?.mode || '2v2';
        const playerName = sanitizeName(payload?.playerName, 'Pilota');

        // Look for an open room of same mode
        let targetRoom: Room | null = null;
        for (const r of rooms.values()) {
          if (r.mode === mode && r.players.size < maxPlayersForMode(r.mode)) {
            targetRoom = r;
            break;
          }
        }

        if (targetRoom) {
          leaveCurrentRoom(socket);
          const team = pickBalancedTeam(targetRoom);
          const player: LobbyPlayer = {
            id: socket.id,
            name: playerName,
            team,
            ready: true,
            isHost: false,
            customization:
              payload?.customization ||
              (team === 'blue'
                ? { ...DEFAULT_CUSTOMIZATION_BLUE }
                : { ...DEFAULT_CUSTOMIZATION_ORANGE }),
          };
          targetRoom.players.set(socket.id, player);
          socketToRoom.set(socket.id, targetRoom.code);
          socket.join(targetRoom.code);

          if (targetRoom.gameState) {
            const botSlot = targetRoom.gameState.cars.find((c) => c.isBot && c.team === team);
            if (botSlot) {
              botSlot.id = socket.id;
              botSlot.name = playerName;
              botSlot.isBot = false;
              botSlot.customization = player.customization;
            }
            socket.emit('room:joined', toRoomDetail(targetRoom));
            socket.emit('match:started', targetRoom.gameState);
          } else {
            socket.emit('room:joined', toRoomDetail(targetRoom));
            startRoomMatch(targetRoom);
          }
          io.to(targetRoom.code).emit('room:updated', toRoomDetail(targetRoom));
          broadcastRoomsList();
          return;
        }

        // Otherwise create a new public room and start right away with bot fill!
        leaveCurrentRoom(socket);
        const code = generateRoomCode();
        const room: Room = {
          code,
          name: `Partita Rapida ${mode.toUpperCase()}`,
          mode,
          arenaId: 'dfh_night',
          hostId: socket.id,
          fillBots: true,
          players: new Map(),
          inputs: new Map(),
          gameState: null,
          tickInterval: null,
          lastTickMs: Date.now(),
          broadcastCounter: 0,
        };

        const player: LobbyPlayer = {
          id: socket.id,
          name: playerName,
          team: 'blue',
          ready: true,
          isHost: true,
          customization: payload?.customization || { ...DEFAULT_CUSTOMIZATION_BLUE },
        };
        room.players.set(socket.id, player);
        rooms.set(code, room);
        socketToRoom.set(socket.id, code);
        socket.join(code);

        socket.emit('room:joined', toRoomDetail(room));
        startRoomMatch(room);
      },
    );

    socket.on('room:team', (payload: { team: Team }) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      if (payload?.team === 'blue' || payload?.team === 'orange') {
        player.team = payload.team;
        io.to(code).emit('room:updated', toRoomDetail(room));
      }
    });

    socket.on('room:bots', (payload: { fillBots: boolean }) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.hostId !== socket.id) return;
      room.fillBots = Boolean(payload?.fillBots);
      io.to(code).emit('room:updated', toRoomDetail(room));
      broadcastRoomsList();
    });

    socket.on('room:arena', (payload: { arenaId: ArenaId }) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.hostId !== socket.id) return;
      room.arenaId = payload.arenaId;
      io.to(code).emit('room:updated', toRoomDetail(room));
      broadcastRoomsList();
    });

    socket.on('room:customize', (payload: { customization: CarCustomization }) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player || !payload?.customization) return;
      player.customization = normalizeCarCustomization(payload.customization, player.customization);
      io.to(code).emit('room:updated', toRoomDetail(room));
    });

    socket.on('match:start', () => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.hostId !== socket.id) return;
      startRoomMatch(room);
    });

    socket.on('match:rematch', () => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.hostId !== socket.id) return;
      startRoomMatch(room);
    });

    socket.on('player:input', (input: PlayerInput) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      room.inputs.set(socket.id, sanitizeInput(input));
    });

    socket.on('chat:send', (payload: { text: string }) => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.get(socket.id);
      if (!player) return;
      const text = String(payload?.text || '').trim().slice(0, 64);
      if (!text) return;

      const msg: QuickChatEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        playerName: player.name,
        team: player.team,
        text,
        timestamp: Date.now(),
      };
      io.to(code).emit('chat:message', msg);
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom(socket);
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(socket);
    });
  });

  if (!IS_PROD) {
    const vite = await import('vite');
    const viteServer = await vite.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    const indexFile = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(indexFile, (err) => {
        if (err) {
          res.status(200).json({ ok: true, service: 'Turbo League Multiplayer Server' });
        }
      });
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Turbo League server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

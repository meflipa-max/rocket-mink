import { useCallback, useEffect, useRef, useState } from 'react';
import { MultiplayerClient } from './game/multiplayer';
import { GarageModal } from './components/GarageModal';
import { MatchHud, QUICK_CHAT_OPTIONS } from './components/MatchHud';
import { MatchEndModal, PauseModal } from './components/MatchModals';
import { MultiplayerLobby } from './components/MultiplayerLobby';
import { TitleScreen } from './components/TitleScreen';
import {
  GameViewportController,
  type GoalMarkerProjection,
  type HudTelemetry,
  type NameplateProjection,
} from './game/renderer';
import { soundEngine } from './game/sound';
import { createMatchState, type PlayerSeed, type SimulationEvent } from './shared/physics';
import type {
  ArenaId,
  CarCustomization,
  CarState,
  GameEventNotification,
  GameStateSnapshot,
  MatchMode,
  QuickChatEvent,
  RoomDetail,
  RoomSummary,
  Team,
} from './shared/types';
import { DEFAULT_CUSTOMIZATION_BLUE, DEFAULT_CUSTOMIZATION_ORANGE } from './shared/types';
import { normalizeRoomCodeInput } from './shared/roomHelpers';

type AppScreenState = 'title' | 'playing' | 'paused' | 'gameover';

const INITIAL_HUD: HudTelemetry = {
  boost: 33,
  speedKph: 0,
  supersonic: false,
  onWall: false,
  ballCam: true,
  scoreBlue: 0,
  scoreOrange: 0,
  clockSeconds: 300,
  isOvertime: false,
  phase: 'countdown',
  phaseTimer: 3,
  lastGoalScorer: null,
  lastGoalTeam: null,
  lastGoalSpeedKph: 0,
  winner: null,
};

function loadStoredCustomization(): CarCustomization {
  try {
    const raw = localStorage.getItem('turbo_league_car');
    if (raw) return { ...DEFAULT_CUSTOMIZATION_BLUE, ...JSON.parse(raw) };
  } catch {
    // ignore storage errors
  }
  return { ...DEFAULT_CUSTOMIZATION_BLUE };
}

function loadStoredName(): string {
  try {
    return localStorage.getItem('turbo_league_name') || 'Pilota';
  } catch {
    return 'Pilota';
  }
}

function getInitialInviteCode(): string {
  try {
    return normalizeRoomCodeInput(new URLSearchParams(window.location.search).get('room') || '');
  } catch {
    return '';
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GameViewportController | null>(null);
  const socketRef = useRef<MultiplayerClient | null>(null);
  const [initialInviteCode] = useState<string>(getInitialInviteCode);

  const [screenState, setScreenState] = useState<AppScreenState>('title');
  const [subModal, setSubModal] = useState<'none' | 'multiplayer' | 'garage'>(() =>
    getInitialInviteCode() ? 'multiplayer' : 'none',
  );

  const [playerName, setPlayerName] = useState<string>(loadStoredName);
  const [customization, setCustomization] = useState<CarCustomization>(loadStoredCustomization);
  const [selectedMode, setSelectedMode] = useState<MatchMode>('1v1');
  const [selectedArena, setSelectedArena] = useState<ArenaId>('dfh_night');

  // Multiplayer state
  const [serverStatus, setServerStatus] = useState<'connecting' | 'online' | 'static_only'>('connecting');
  const [socketId, setSocketId] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [currentRoom, setCurrentRoom] = useState<RoomDetail | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [joiningCode, setJoiningCode] = useState<string | null>(() => getInitialInviteCode() || null);
  const [isMultiplayerMatch, setIsMultiplayerMatch] = useState(false);

  // Live HUD state
  const [hud, setHud] = useState<HudTelemetry>(INITIAL_HUD);
  const [nameplates, setNameplates] = useState<NameplateProjection[]>([]);
  const [goalMarkers, setGoalMarkers] = useState<GoalMarkerProjection[]>([]);
  const [carsSnapshot, setCarsSnapshot] = useState<CarState[]>([]);
  const [localPlayerId, setLocalPlayerId] = useState<string>('local-player');
  const localPlayerIdRef = useRef(localPlayerId);
  localPlayerIdRef.current = localPlayerId;
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [muted, setMuted] = useState(false);
  const [chatMessages, setChatMessages] = useState<QuickChatEvent[]>([]);
  const [notifications, setNotifications] = useState<GameEventNotification[]>([]);

  const screenStateRef = useRef(screenState);
  screenStateRef.current = screenState;
  const subModalRef = useRef(subModal);
  subModalRef.current = subModal;
  const isMultiplayerRef = useRef(isMultiplayerMatch);
  isMultiplayerRef.current = isMultiplayerMatch;
  const localConfigRef = useRef({ mode: selectedMode, arena: selectedArena, name: playerName, customization });
  localConfigRef.current = { mode: selectedMode, arena: selectedArena, name: playerName, customization };

  // Sync body[data-state]
  useEffect(() => {
    document.body.dataset.state = screenState;
  }, [screenState]);

  const pushNotification = useCallback((n: Omit<GameEventNotification, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setNotifications((prev) => [...prev.slice(-3), { ...n, id }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
    }, 3500);
  }, []);

  const handleEvents = useCallback(
    (events: SimulationEvent[]) => {
      for (const ev of events) {
        if (ev.type === 'goal') {
          pushNotification({
            kind: 'goal',
            title: 'GOL!',
            subtitle: `${ev.scorerName} (${ev.speedKph} km/h)`,
            team: ev.team,
            highlight: true,
            points: 100,
          });
        } else if (ev.type === 'save') {
          pushNotification({
            kind: 'save',
            title: 'PARATA!',
            subtitle: ev.playerName,
            team: ev.team,
            highlight: ev.playerId === localPlayerIdRef.current,
            points: 50,
          });
        } else if (ev.type === 'shot') {
          pushNotification({ kind: 'shot', title: ev.aerial ? 'TIRO AEREO!' : 'TIRO IN PORTA!', subtitle: ev.playerName, team: ev.team, points: 10, highlight: ev.playerId === localPlayerIdRef.current });
        } else if (ev.type === 'demo') {
          const cars = controllerRef.current?.getCarsSnapshot() ?? [];
          const attacker = cars.find((c) => c.id === ev.attackerId);
          const victim = cars.find((c) => c.id === ev.victimId);
          pushNotification({
            kind: 'demo',
            title: 'BOOM!',
            subtitle: `${attacker?.name ?? 'Pilota'} → ${victim?.name ?? 'Avversario'}`,
            team: attacker?.team,
            highlight: ev.attackerId === localPlayerIdRef.current || ev.victimId === localPlayerIdRef.current,
            points: ev.attackerId === localPlayerIdRef.current ? 25 : undefined,
          });
        } else if (ev.type === 'overtime') {
          pushNotification({
            kind: 'overtime',
            title: 'TEMPI SUPPLEMENTARI!',
            subtitle: 'Golden Goal attivo',
          });
        } else if (ev.type === 'match_ended') {
          if (controllerRef.current) {
            setCarsSnapshot(controllerRef.current.getCarsSnapshot());
          }
          setScreenState('gameover');
          controllerRef.current?.setMode('gameover');
        }
      }
    },
    [pushNotification],
  );

  const startLocalBotMatch = useCallback((mode: MatchMode, arenaId: ArenaId) => {
    soundEngine.unlock();
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const name = localConfigRef.current.name.trim() || 'Pilota';
    const cust = localConfigRef.current.customization;
    const localId = 'local-player';
    const seeds: PlayerSeed[] = [
      { id: localId, name, team: 'blue', isBot: false, customization: cust },
    ];

    const botNames = ['Maverick [BOT]', 'Vortex [BOT]', 'Cobra [BOT]', 'Apex [BOT]', 'Nova [BOT]'];
    if (mode !== 'freeplay') {
      const perTeam = mode === '1v1' ? 1 : mode === '2v2' ? 2 : 3;
      let bIdx = 0;
      for (let i = 1; i < perTeam; i++) {
        seeds.push({
          id: `bot-b-${i}`,
          name: botNames[bIdx++ % botNames.length],
          team: 'blue',
          isBot: true,
          customization: { ...DEFAULT_CUSTOMIZATION_BLUE },
        });
      }
      for (let i = 0; i < perTeam; i++) {
        seeds.push({
          id: `bot-o-${i}`,
          name: botNames[bIdx++ % botNames.length],
          team: 'orange',
          isBot: true,
          customization: { ...DEFAULT_CUSTOMIZATION_ORANGE },
        });
      }
    }

    const snap = createMatchState(mode, arenaId, seeds);
    setIsMultiplayerMatch(false);
    setLocalPlayerId(localId);
    setCarsSnapshot(snap.cars);
    setSubModal('none');
    setScreenState('playing');
    ctrl.startLocalMatch(snap, localId);
  }, []);

  const handleQuickPlay = useCallback(() => {
    soundEngine.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const sock = socketRef.current;
    if (sock && sock.connected && selectedMode !== 'freeplay') {
      sock.emit('matchmaking:quick', {
        playerName,
        mode: selectedMode,
        customization,
      });
    } else {
      startLocalBotMatch(selectedMode, selectedArena);
    }
  }, [customization, playerName, selectedArena, selectedMode, startLocalBotMatch]);

  // Mount Three.js controller once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const ctrl = new GameViewportController(container);
    controllerRef.current = ctrl;

    ctrl.onHudUpdate = (nextHud) => {
      setHud(nextHud);
      if (nextHud.phase === 'ended' && screenStateRef.current === 'playing') {
        setCarsSnapshot(ctrl.getCarsSnapshot());
        setScreenState('gameover');
        ctrl.setMode('gameover');
      }
    };
    ctrl.onNameplates = (plates) => setNameplates(plates);
    ctrl.onGoalMarkers = (markers) => setGoalMarkers(markers);
    ctrl.onEvents = handleEvents;
    ctrl.onSendInput = (input) => {
      socketRef.current?.emit('player:input', input);
    };
    ctrl.onPauseToggle = () => {
      if (screenStateRef.current === 'playing') {
        setScreenState('paused');
        ctrl.setMode('paused');
      } else if (screenStateRef.current === 'paused') {
        setScreenState('playing');
        ctrl.setMode('playing');
      }
    };
    ctrl.onQuickChatKey = (slot) => {
      const text = QUICK_CHAT_OPTIONS[slot];
      if (!text) return;
      if (isMultiplayerRef.current && socketRef.current?.connected) {
        socketRef.current.emit('chat:send', { text });
      } else {
        const msg: QuickChatEvent = {
          id: `${Date.now()}`,
          playerName: localConfigRef.current.name || 'Pilota',
          team: 'blue',
          text,
          timestamp: Date.now(),
        };
        setChatMessages((prev) => [...prev.slice(-3), msg]);
      }
    };
    ctrl.onSkipReplay = () => {
      if (isMultiplayerRef.current && socketRef.current?.connected) {
        socketRef.current.emit('replay:skip');
      } else {
        ctrl.skipGoalReplayOffline();
      }
    };

    // ?autostart=1 skips straight to live gameplay
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      startLocalBotMatch('1v1', 'dfh_night');
    }

    return () => {
      ctrl.dispose();
      controllerRef.current = null;
    };
  }, [handleEvents, startLocalBotMatch]);

  // Connect to signaling; match traffic uses direct browser connections.
  useEffect(() => {
    let sock: MultiplayerClient | null = null;
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
      setServerStatus('static_only');
      setJoiningCode(null);
      return;
    }
    try {
      sock = new MultiplayerClient();
      socketRef.current = sock;
      let autoJoinedInvite = false;
      sock.on('connect', () => {
        setServerStatus('online');
        setSocketId(sock?.id || '');
        sock?.emit('rooms:list');

        if (!autoJoinedInvite) {
          autoJoinedInvite = true;
          const inviteCode = getInitialInviteCode();
          if (inviteCode) {
            setSubModal('multiplayer');
            setRoomError(null);
            setJoiningCode(inviteCode);
            sock?.emit('room:join', {
              code: inviteCode,
              playerName: localConfigRef.current.name,
              customization: localConfigRef.current.customization,
            });
          }
        }
      });

      sock.on('disconnect', () => {
        setServerStatus('connecting');
        setSocketId('');
        setCurrentRoom(null);
        setJoiningCode(null);
        setRooms([]);
        if (isMultiplayerRef.current) {
          setIsMultiplayerMatch(false);
          setScreenState('title');
          controllerRef.current?.setMode('title');
          setRoomError('Connessione persa. Rientra nella stanza dopo la riconnessione.');
          setSubModal('multiplayer');
        }
      });
      sock.on('connect_error', () => {
        setServerStatus('static_only');
        setJoiningCode(null);
      });

      sock.on('rooms:update', (list: RoomSummary[]) => {
        setRooms(list);
      });

      sock.on('room:joined', (detail: RoomDetail) => {
        setRoomError(null);
        setJoiningCode(null);
        setCurrentRoom(detail);
      });

      sock.on('room:updated', (detail: RoomDetail) => {
        setCurrentRoom(detail);
      });

      sock.on('room:error', (msg: string) => {
        setJoiningCode(null);
        setRoomError(msg);
      });

      sock.on('match:started', (snapshot: GameStateSnapshot) => {
        const myId = sock?.id || 'local-player';
        setJoiningCode(null);
        setIsMultiplayerMatch(true);
        setLocalPlayerId(myId);
        setCarsSnapshot(snapshot.cars);
        setSubModal('none');
        setScreenState('playing');
        controllerRef.current?.startMultiplayerMatch(snapshot, myId);
      });

      sock.on('game:state', (snapshot: GameStateSnapshot) => {
        controllerRef.current?.applyNetworkSnapshot(snapshot);
      });

      sock.on('game:events', (events: SimulationEvent[]) => {
        if (events.some((ev) => ev.type === 'goal' || ev.type === 'demo' || ev.type === 'save')) {
          if (controllerRef.current) {
            setCarsSnapshot([...controllerRef.current.getCarsSnapshot()]);
          }
        }
        controllerRef.current?.handleSimulationEvents(events);
      });

      sock.on('chat:message', (msg: QuickChatEvent) => {
        setChatMessages((prev) => [...prev.slice(-3), msg]);
        window.setTimeout(() => {
          setChatMessages((prev) => prev.filter((m) => m.id !== msg.id));
        }, 4500);
      });
    } catch {
      setServerStatus('static_only');
    }

    return () => {
      sock?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Global keyboard shortcuts (Title Enter/Space start, Mute M, Scoreboard Tab)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (
        screenStateRef.current === 'title' &&
        subModalRef.current === 'none' &&
        (e.code === 'Enter' || e.code === 'Space')
      ) {
        e.preventDefault();
        handleQuickPlay();
        return;
      }

      if (e.code === 'KeyM') {
        const nextMuted = soundEngine.toggleMute();
        setMuted(nextMuted);
      }

      if (e.code === 'Tab' && screenStateRef.current === 'playing') {
        e.preventDefault();
        if (controllerRef.current) {
          setCarsSnapshot([...controllerRef.current.getCarsSnapshot()]);
        }
        setShowScoreboard(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setShowScoreboard(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handleQuickPlay]);

  const handleNameChange = (name: string) => {
    setPlayerName(name);
    try {
      localStorage.setItem('turbo_league_name', name);
    } catch {
      // ignore
    }
  };

  const handleCustomizationChange = (next: CarCustomization) => {
    setCustomization(next);
    controllerRef.current?.setGaragePreview(next);
    socketRef.current?.emit('room:customize', { customization: next });
    try {
      localStorage.setItem('turbo_league_car', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleArenaChange = (arena: ArenaId) => {
    setSelectedArena(arena);
    controllerRef.current?.setArenaTheme(arena);
  };

  const handleQuitToTitle = () => {
    if (isMultiplayerMatch) {
      socketRef.current?.emit('room:leave');
      setCurrentRoom(null);
    }
    setIsMultiplayerMatch(false);
    setShowScoreboard(false);
    setScreenState('title');
    setSubModal('none');
    controllerRef.current?.setMode('title');
  };

  const handleRematch = () => {
    if (isMultiplayerMatch && socketRef.current?.connected) {
      socketRef.current.emit('match:rematch');
    } else {
      startLocalBotMatch(selectedMode, selectedArena);
    }
  };

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#090d16]">
      {/* Dedicated Isolated WebGL Container */}
      <div ref={mountRef} className="fixed inset-0 z-0" />

      {/* Title Screen & Sub-Modals */}
      {screenState === 'title' && subModal === 'none' && (
        <TitleScreen
          playerName={playerName}
          onPlayerNameChange={handleNameChange}
          selectedMode={selectedMode}
          onSelectMode={setSelectedMode}
          selectedArena={selectedArena}
          onSelectArena={handleArenaChange}
          onQuickPlay={handleQuickPlay}
          onStartLocalBots={(m) => startLocalBotMatch(m, selectedArena)}
          onOpenMultiplayer={() => {
            setRoomError(null);
            socketRef.current?.emit('rooms:list');
            setSubModal('multiplayer');
          }}
          onOpenGarage={() => {
            controllerRef.current?.setGaragePreview(customization);
            controllerRef.current?.setMode('garage');
            setSubModal('garage');
          }}
          onlineConnected={serverStatus === 'online'}
          serverStatus={serverStatus}
        />
      )}

      {screenState === 'title' && subModal === 'garage' && (
        <GarageModal
          customization={customization}
          onChange={handleCustomizationChange}
          onClose={() => {
            controllerRef.current?.setMode('title');
            setSubModal('none');
          }}
        />
      )}

      {screenState === 'title' && subModal === 'multiplayer' && (
        <MultiplayerLobby
          playerName={playerName}
          rooms={rooms}
          currentRoom={currentRoom}
          localSocketId={socketId}
          errorMsg={roomError}
          joiningCode={joiningCode}
          initialJoinCode={initialInviteCode}
          serverStatus={serverStatus}
          serverOffline={serverStatus === 'static_only'}
          onCreateRoom={({ roomName, mode, arenaId, fillBots }) => {
            setRoomError(null);
            setJoiningCode(null);
            socketRef.current?.emit('room:create', {
              playerName,
              roomName,
              mode,
              arenaId,
              fillBots,
              customization,
            });
          }}
          onJoinRoom={(code) => {
            const normalized = normalizeRoomCodeInput(code);
            if (!normalized) {
              setRoomError('Inserisci un codice stanza valido.');
              return;
            }
            if (!socketRef.current || serverStatus === 'static_only') {
              setRoomError('Server multiplayer non collegato su questo host.');
              return;
            }
            setRoomError(null);
            setJoiningCode(normalized);
            socketRef.current.emit('room:join', {
              code: normalized,
              playerName,
              customization,
            });
          }}
          onSwitchTeam={(team: Team) => socketRef.current?.emit('room:team', { team })}
          onToggleBots={(fillBots) => socketRef.current?.emit('room:bots', { fillBots })}
          onStartMatch={() => socketRef.current?.emit('match:start')}
          onLeaveRoom={() => {
            socketRef.current?.emit('room:leave');
            setCurrentRoom(null);
            setJoiningCode(null);
          }}
          onRefreshRooms={() => socketRef.current?.emit('rooms:list')}
          onClose={() => {
            setJoiningCode(null);
            setRoomError(null);
            if (window.location.search.includes('room=')) {
              const url = new URL(window.location.href);
              url.searchParams.delete('room');
              window.history.replaceState({}, '', url.pathname + url.search);
            }
            setSubModal('none');
          }}
        />
      )}

      {/* Active Gameplay HUD */}
      {(screenState === 'playing' || screenState === 'paused') && (
        <MatchHud
          hud={hud}
          nameplates={nameplates}
          goalMarkers={goalMarkers}
          cars={carsSnapshot}
          localPlayerId={localPlayerId}
          localTeam={carsSnapshot.find((c) => c.id === localPlayerId)?.team || 'blue'}
          showScoreboard={showScoreboard}
          muted={muted}
          roomCode={currentRoom?.code ?? null}
          chatMessages={chatMessages}
          notifications={notifications}
          canSkipReplay={!isMultiplayerMatch || currentRoom?.hostId === socketId}
          onToggleMute={() => setMuted(soundEngine.toggleMute())}
          onTogglePause={() => {
            if (screenState === 'playing') {
              setScreenState('paused');
              controllerRef.current?.setMode('paused');
            } else {
              setScreenState('playing');
              controllerRef.current?.setMode('playing');
            }
          }}
          onToggleBallCam={() => {
            controllerRef.current?.toggleBallCam();
          }}
          onQuickChat={(slot) => {
            const text = QUICK_CHAT_OPTIONS[slot];
            if (!text) return;
            if (isMultiplayerMatch && socketRef.current?.connected) {
              socketRef.current.emit('chat:send', { text });
            } else {
              setChatMessages((prev) => [
                ...prev.slice(-3),
                {
                  id: `${Date.now()}`,
                  playerName: playerName || 'Pilota',
                  team: 'blue',
                  text,
                  timestamp: Date.now(),
                },
              ]);
            }
          }}
          onSkipReplay={() => {
            if (isMultiplayerMatch && socketRef.current?.connected) {
              socketRef.current.emit('replay:skip');
            } else {
              controllerRef.current?.skipGoalReplayOffline();
            }
          }}
        />
      )}

      {/* Pause Modal */}
      {screenState === 'paused' && (
        <PauseModal
          isMultiplayer={isMultiplayerMatch}
          onResume={() => {
            setScreenState('playing');
            controllerRef.current?.setMode('playing');
          }}
          onRestart={() => startLocalBotMatch(selectedMode, selectedArena)}
          onQuitToTitle={handleQuitToTitle}
        />
      )}

      {/* Match End Modal */}
      {screenState === 'gameover' && (
        <MatchEndModal
          winner={hud.winner}
          scoreBlue={hud.scoreBlue}
          scoreOrange={hud.scoreOrange}
          cars={carsSnapshot}
          localPlayerId={localPlayerId}
          onRematch={handleRematch}
          onQuitToTitle={handleQuitToTitle}
        />
      )}
    </main>
  );
}

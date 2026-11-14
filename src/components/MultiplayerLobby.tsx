import { useEffect, useState, type FormEvent } from 'react';
import { normalizeRoomCodeInput } from '../shared/roomHelpers';
import type { ArenaId, MatchMode, RoomDetail, RoomSummary, Team } from '../shared/types';

interface MultiplayerLobbyProps {
  playerName: string;
  rooms: RoomSummary[];
  currentRoom: RoomDetail | null;
  localSocketId: string;
  errorMsg: string | null;
  joiningCode?: string | null;
  initialJoinCode?: string;
  serverStatus?: 'connecting' | 'online' | 'static_only';
  serverOffline?: boolean;
  onCreateRoom: (opts: {
    roomName: string;
    mode: MatchMode;
    arenaId: ArenaId;
    fillBots: boolean;
  }) => void;
  onJoinRoom: (code: string) => void;
  onSwitchTeam: (team: Team) => void;
  onToggleBots: (fillBots: boolean) => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onRefreshRooms: () => void;
  onClose: () => void;
}

export function MultiplayerLobby({
  playerName,
  rooms,
  currentRoom,
  localSocketId,
  errorMsg,
  joiningCode = null,
  initialJoinCode = '',
  serverStatus = 'online',
  serverOffline = false,
  onCreateRoom,
  onJoinRoom,
  onSwitchTeam,
  onToggleBots,
  onStartMatch,
  onLeaveRoom,
  onRefreshRooms,
  onClose,
}: MultiplayerLobbyProps) {
  const [roomName, setRoomName] = useState(`Arena di ${playerName || 'Pilota'}`);
  const [mode, setMode] = useState<MatchMode>('2v2');
  const [arenaId, setArenaId] = useState<ArenaId>('dfh_night');
  const [fillBots, setFillBots] = useState(true);
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [copied, setCopied] = useState<'none' | 'code' | 'link'>('none');

  useEffect(() => {
    if (initialJoinCode) {
      setJoinCode(initialJoinCode);
    }
  }, [initialJoinCode]);

  const isHost = currentRoom ? currentRoom.hostId === localSocketId : false;
  const isJoining = Boolean(joiningCode);

  const copyCode = () => {
    if (!currentRoom) return;
    navigator.clipboard?.writeText(currentRoom.code).catch(() => {});
    setCopied('code');
    setTimeout(() => setCopied('none'), 1800);
  };

  const copyInviteLink = () => {
    if (!currentRoom) return;
    const url = `${window.location.origin}/?room=${currentRoom.code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied('link');
    setTimeout(() => setCopied('none'), 1800);
  };

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCodeInput(joinCode);
    if (!normalized) return;
    setJoinCode(normalized);
    onJoinRoom(normalized);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-4xl bg-[#0b101c] border border-white/15 rounded-xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Pinned Header + Status / Error Banners (always visible even when scrolled) */}
        <div className="p-6 pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">
                Multigiocatore Online PC
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Stanze in tempo reale ospitate da un giocatore · Condividi il link o il codice stanza con i tuoi amici
              </p>
            </div>
            <button
              type="button"
              onClick={currentRoom ? onLeaveRoom : onClose}
              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white cursor-pointer shrink-0"
            >
              {currentRoom ? 'Esci dalla Stanza' : 'Torna al Menu'}
            </button>
          </div>

          {serverOffline && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-amber-500/15 border border-amber-400/35 text-amber-100 text-xs leading-relaxed">
              <strong className="font-bold">Server WebSocket non collegato su questo host statico:</strong>{' '}
              Il server multiplayer non è raggiungibile. Puoi giocare contro i bot mentre la connessione viene riprovata.
            </div>
          )}

          {!serverOffline && serverStatus === 'connecting' && (
            <div
              role="status"
              className="mt-4 px-4 py-2.5 rounded-lg bg-sky-500/15 border border-sky-400/35 text-sky-200 text-xs font-medium"
            >
              Connessione al server di segnalazione in corso...
            </div>
          )}

          {isJoining && (
            <div
              role="status"
              className="mt-4 px-4 py-2.5 rounded-lg bg-sky-500/20 border border-sky-400/45 text-sky-100 text-xs font-semibold"
            >
              Connessione alla stanza <span className="font-mono-nums">{joiningCode}</span> in corso...
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 px-4 py-2.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-medium"
            >
              {errorMsg}
            </div>
          )}
        </div>

        <div className="p-6 pt-5 overflow-y-auto">
          {currentRoom ? (
            /* Inside Room Staging View */
            <div>
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6 p-4 rounded-lg bg-[#111827] border border-white/10">
                <div>
                  <div className="text-xs text-slate-400">Stanza Attiva</div>
                  <div className="font-display text-xl font-bold text-white">
                    {currentRoom.name}
                  </div>
                  <div className="text-xs text-slate-300 mt-1">
                    Modalità: {currentRoom.mode.toUpperCase()} · Giocatori: {currentRoom.players.length}/
                    {currentRoom.maxPlayers}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="text-right mr-1">
                    <div className="text-xs text-slate-400">Codice Stanza</div>
                    <div className="font-mono-nums text-2xl font-bold tracking-widest text-sky-400">
                      {currentRoom.code}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
                  >
                    {copied === 'code' ? 'Codice Copiato!' : 'Copia Codice'}
                  </button>
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-xs font-bold text-slate-950 cursor-pointer whitespace-nowrap"
                  >
                    {copied === 'link' ? 'Link Copiato!' : 'Copia Link Invito'}
                  </button>
                </div>
              </div>

              {/* Teams Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Blue Team */}
                <div className="p-4 rounded-lg bg-blue-950/35 border border-blue-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-bold text-sky-300">
                      SQUADRA BLU
                    </h3>
                    <button
                      type="button"
                      onClick={() => onSwitchTeam('blue')}
                      className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/35 text-xs font-semibold text-sky-200 cursor-pointer"
                    >
                      Unisciti a Blu
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentRoom.players
                      .filter((p) => p.team === 'blue')
                      .map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between px-3 py-2 rounded bg-black/35 text-sm"
                        >
                          <span className="font-semibold text-white">
                            {p.name} {p.id === localSocketId ? '(Tu)' : ''}
                          </span>
                          <span className="text-xs text-sky-300">
                            {p.isHost ? 'Host' : 'Pronto'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Orange Team */}
                <div className="p-4 rounded-lg bg-orange-950/35 border border-orange-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-bold text-orange-300">
                      SQUADRA ARANCIONE
                    </h3>
                    <button
                      type="button"
                      onClick={() => onSwitchTeam('orange')}
                      className="px-2.5 py-1 rounded bg-orange-500/20 hover:bg-orange-500/35 text-xs font-semibold text-orange-200 cursor-pointer"
                    >
                      Unisciti ad Arancione
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentRoom.players
                      .filter((p) => p.team === 'orange')
                      .map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between px-3 py-2 rounded bg-black/35 text-sm"
                        >
                          <span className="font-semibold text-white">
                            {p.name} {p.id === localSocketId ? '(Tu)' : ''}
                          </span>
                          <span className="text-xs text-orange-300">
                            {p.isHost ? 'Host' : 'Pronto'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Host Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/10">
                <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentRoom.fillBots}
                    disabled={!isHost}
                    onChange={(e) => onToggleBots(e.target.checked)}
                    className="w-4 h-4 accent-sky-500"
                  />
                  <span>Completa gli slot vuoti con Bot AI</span>
                </label>

                {isHost ? (
                  <button
                    type="button"
                    onClick={onStartMatch}
                    className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-display font-extrabold text-sm tracking-wide cursor-pointer"
                  >
                    AVVIA PARTITA
                  </button>
                ) : (
                  <span className="text-xs font-medium text-slate-300">
                    In attesa che l&apos;Host avvii la partita...
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* Room Browser & Create/Join View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Create Room */}
              <div className="p-4 rounded-lg bg-[#111827] border border-white/10">
                <h3 className="font-display text-lg font-bold text-white mb-4">
                  Crea Nuova Stanza
                </h3>
                <div className="space-y-3.5">
                  <div>
                    <label
                      htmlFor="room-name-input"
                      className="block text-xs font-semibold text-slate-300 mb-1"
                    >
                      Nome Stanza
                    </label>
                    <input
                      id="room-name-input"
                      type="text"
                      value={roomName}
                      maxLength={24}
                      onChange={(e) => setRoomName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#090d16] border border-white/15 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Formato
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['1v1', '2v2', '3v3'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m)}
                          className={`py-2 rounded-md text-xs font-bold cursor-pointer ${
                            mode === m
                              ? 'bg-sky-500 text-slate-950'
                              : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          {m.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="room-arena-select"
                      className="block text-xs font-semibold text-slate-300 mb-1"
                    >
                      Stadio
                    </label>
                    <select
                      id="room-arena-select"
                      value={arenaId}
                      onChange={(e) => setArenaId(e.target.value as ArenaId)}
                      className="w-full px-3 py-2 rounded-lg bg-[#090d16] border border-white/15 text-sm text-white"
                    >
                      <option value="dfh_night">DFH Stadium (Notturno)</option>
                      <option value="neo_tokyo">Neo-Arena (Urbana)</option>
                      <option value="mannfield_day">Campo Verde (Diurno)</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fillBots}
                      onChange={(e) => setFillBots(e.target.checked)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span>Aggiungi Bot AI per gli slot liberi</span>
                  </label>

                  <button
                    type="button"
                    disabled={serverOffline || isJoining}
                    onClick={() => onCreateRoom({ roomName, mode, arenaId, fillBots })}
                    className="w-full py-3 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-slate-950 font-display font-extrabold text-sm tracking-wide cursor-pointer"
                  >
                    CREA STANZA
                  </button>
                </div>
              </div>

              {/* Right: Join by Code & Public Rooms List */}
              <div className="flex flex-col gap-4">
                <form
                  onSubmit={handleJoinSubmit}
                  className="p-4 rounded-lg bg-[#111827] border border-white/10"
                >
                  <label
                    htmlFor="join-code-input"
                    className="block font-display text-lg font-bold text-white mb-3"
                  >
                    Unisciti con Codice
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="join-code-input"
                      type="text"
                      value={joinCode}
                      maxLength={120}
                      placeholder="Codice stanza o link invito"
                      onChange={(e) => setJoinCode(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#090d16] border border-white/15 text-sm font-mono-nums text-white"
                    />
                    <button
                      type="submit"
                      disabled={serverOffline || isJoining || !normalizeRoomCodeInput(joinCode)}
                      className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs cursor-pointer shrink-0"
                    >
                      {isJoining ? 'CONNESSIONE...' : 'ENTRA'}
                    </button>
                  </div>
                </form>

                <div className="flex-1 p-4 rounded-lg bg-[#111827] border border-white/10">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-bold text-white">
                      Stanze Pubbliche ({rooms.length})
                    </h3>
                    <button
                      type="button"
                      onClick={onRefreshRooms}
                      className="text-xs font-semibold text-sky-400 hover:text-sky-300 cursor-pointer"
                    >
                      Aggiorna
                    </button>
                  </div>

                  {rooms.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">
                      Nessuna stanza attiva al momento. Creane una qui a fianco o usa Partita Rapida!
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {rooms.map((r) => (
                        <div
                          key={r.code}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#090d16] border border-white/10"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">{r.name}</div>
                            <div className="text-xs text-slate-400">
                              {r.mode.toUpperCase()} · {r.playerCount}/{r.maxPlayers} giocatori ·{' '}
                              {r.inProgress ? 'In corso (Entra in partita)' : 'In lobby'}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={serverOffline || isJoining || r.playerCount >= r.maxPlayers}
                            onClick={() => onJoinRoom(r.code)}
                            className="px-3 py-1.5 rounded bg-sky-500/20 hover:bg-sky-500/35 disabled:opacity-50 text-xs font-bold text-sky-200 cursor-pointer shrink-0"
                          >
                            {joiningCode === r.code
                              ? 'Connessione...'
                              : r.playerCount >= r.maxPlayers
                                ? 'Piena'
                                : 'Entra'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

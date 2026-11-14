import { useState } from 'react';
import type { ArenaId, MatchMode } from '../shared/types';

interface TitleScreenProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  selectedMode: MatchMode;
  onSelectMode: (mode: MatchMode) => void;
  selectedArena: ArenaId;
  onSelectArena: (arena: ArenaId) => void;
  onQuickPlay: () => void;
  onStartLocalBots: (mode: MatchMode) => void;
  onOpenMultiplayer: () => void;
  onOpenGarage: () => void;
  onlineConnected: boolean;
  serverStatus?: 'connecting' | 'online' | 'static_only';
}

const ARENA_LABELS: Array<{ id: ArenaId; label: string }> = [
  { id: 'dfh_night', label: 'DFH Notturno' },
  { id: 'neo_tokyo', label: 'Neo-Arena' },
  { id: 'mannfield_day', label: 'Stadio Diurno' },
];

export function TitleScreen({
  playerName,
  onPlayerNameChange,
  selectedMode,
  onSelectMode,
  selectedArena,
  onSelectArena,
  onQuickPlay,
  onStartLocalBots,
  onOpenMultiplayer,
  onOpenGarage,
  onlineConnected,
  serverStatus = onlineConnected ? 'online' : 'connecting',
}: TitleScreenProps) {
  const [showSoloModes, setShowSoloModes] = useState(false);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-6 md:p-10">
      {/* Subtle left-side & bottom scrims for crisp text legibility without blurring WebGL */}
      <div
        className="fixed inset-y-0 left-0 w-full max-w-2xl pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(8,12,22,0.9) 0%, rgba(8,12,22,0.68) 62%, rgba(8,12,22,0) 100%)',
        }}
      />
      <div
        className="fixed inset-x-0 bottom-0 h-20 pointer-events-none"
        style={{
          background:
            'linear-gradient(0deg, rgba(8,12,22,0.86) 0%, rgba(8,12,22,0) 100%)',
        }}
      />

      {/* Top row: minimal brand mark + connection status text */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg
            width="44"
            height="44"
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M32 4L56 14V32C56 46.5 45.2 56.4 32 60C18.8 56.4 8 46.5 8 32V14L32 4Z"
              fill="#0f172a"
              stroke="#38bdf8"
              strokeWidth="3"
            />
            <path d="M18 26L32 16L46 26L32 34L18 26Z" fill="#38bdf8" />
            <path d="M18 36L32 44L46 36L32 52L18 36Z" fill="#f97316" />
          </svg>
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-white hud-text-shadow leading-none">
              TURBO LEAGUE
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              Calcio con Auto a Razzo 3D · PC Multiplayer
            </p>
          </div>
        </div>

        <div className="text-xs font-medium text-slate-300 bg-[#0b101c]/90 border border-white/10 px-3 py-1.5 rounded-md">
          {serverStatus === 'online'
            ? 'Server Online Pronto'
            : serverStatus === 'static_only'
              ? 'Modalità Locale (Bot AI)'
              : 'Connessione Server...'}
        </div>
      </div>

      {/* Main Left-Aligned Menu Stack */}
      <div className="relative z-10 max-w-md my-auto pointer-events-auto">
        <div className="mb-5">
          <label
            htmlFor="pilot-name-input"
            className="block text-xs font-semibold text-slate-300 mb-1.5"
          >
            Nome Pilota
          </label>
          <input
            id="pilot-name-input"
            type="text"
            maxLength={18}
            value={playerName}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            placeholder="Inserisci il tuo nickname"
            className="w-full px-3.5 py-2.5 rounded-lg bg-[#0d1424]/95 border border-white/15 text-white text-sm font-medium focus:outline-none focus:border-sky-400"
          />
        </div>

        {/* Mode Selector Segmented Tabs */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Formato Partita
          </span>
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-lg bg-[#0d1424]/95 border border-white/10">
            {(['1v1', '2v2', '3v3', 'freeplay'] as MatchMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onSelectMode(m)}
                className={`py-2 px-2 rounded-md text-xs font-bold transition-colors whitespace-nowrap ${
                  selectedMode === m
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {m === 'freeplay' ? 'Libera' : m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Arena Theme Selector */}
        <div className="mb-6">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Stadio
          </span>
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#0d1424]/95 border border-white/10">
            {ARENA_LABELS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectArena(a.id)}
                className={`py-2 px-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap truncate ${
                  selectedArena === a.id
                    ? 'bg-orange-500 text-slate-950'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Primary & Secondary Action Buttons */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onQuickPlay}
            className="w-full py-3.5 px-5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-display font-extrabold text-base tracking-wide transition-colors shadow-lg cursor-pointer"
          >
            GIOCA ORA (PARTITA RAPIDA)
          </button>

          <button
            type="button"
            onClick={onOpenMultiplayer}
            className="w-full py-3 px-5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-200 font-display font-bold text-sm tracking-wide transition-colors cursor-pointer"
          >
            STANZE MULTIGIOCATORE ONLINE
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setShowSoloModes((v) => !v)}
              className="py-2.5 px-4 rounded-lg bg-[#111827]/95 hover:bg-[#1e293b] border border-white/15 text-slate-100 font-semibold text-sm transition-colors cursor-pointer"
            >
              Partita Locale vs Bot
            </button>
            <button
              type="button"
              onClick={onOpenGarage}
              className="py-2.5 px-4 rounded-lg bg-[#111827]/95 hover:bg-[#1e293b] border border-white/15 text-slate-100 font-semibold text-sm transition-colors cursor-pointer"
            >
              Garage Auto 3D
            </button>
          </div>

          {showSoloModes && (
            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {(['1v1', '2v2', '3v3', 'freeplay'] as MatchMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onStartLocalBots(m)}
                  className="py-2 px-2 rounded-md bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-200 text-xs font-bold cursor-pointer"
                >
                  {m === 'freeplay' ? 'Campo Libero' : `${m.toUpperCase()} Bot`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom flat inline PC control hints */}
      <div className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 hud-text-shadow">
        <span>WASD / Frecce: Guida &amp; Assetto</span>
        <span aria-hidden="true">·</span>
        <span>Spazio (tieni=alto) / x2 + W/A/S/D: Capriola Dritta, Laterale o Obliqua</span>
        <span aria-hidden="true">·</span>
        <span>Q / E o X+A/D in volo: Avvitamento</span>
        <span aria-hidden="true">·</span>
        <span>Shift / Tasto Destro: Turbo</span>
        <span aria-hidden="true">·</span>
        <span>Y / C: Ball Cam</span>
      </div>
    </div>
  );
}

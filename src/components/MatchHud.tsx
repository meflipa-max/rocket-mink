import { Volume2, VolumeX, Pause } from 'lucide-react';
import type { GoalMarkerProjection, HudTelemetry, NameplateProjection } from '../game/renderer';
import type { CarState, GameEventNotification, QuickChatEvent, Team } from '../shared/types';

interface MatchHudProps {
  hud: HudTelemetry;
  nameplates: NameplateProjection[];
  goalMarkers: GoalMarkerProjection[];
  cars: CarState[];
  localPlayerId: string;
  localTeam: Team;
  showScoreboard: boolean;
  muted: boolean;
  roomCode: string | null;
  chatMessages: QuickChatEvent[];
  notifications: GameEventNotification[];
  onToggleMute: () => void;
  onTogglePause: () => void;
  onToggleBallCam: () => void;
  onQuickChat: (slot: number) => void;
}

export const QUICK_CHAT_OPTIONS = [
  'Bel tiro!',
  'Che parata!',
  'Grazie!',
  'Difendo io!',
];

function formatClock(sec: number, isOvertime: boolean): string {
  const s = Math.max(0, Math.ceil(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  const prefix = isOvertime ? '+' : '';
  return `${prefix}${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

export function MatchHud({
  hud,
  nameplates,
  goalMarkers,
  cars,
  localPlayerId,
  localTeam,
  showScoreboard,
  muted,
  roomCode,
  chatMessages,
  notifications,
  onToggleMute,
  onTogglePause,
  onToggleBallCam,
  onQuickChat,
}: MatchHudProps) {
  const targetTeam: Team = localTeam === 'blue' ? 'orange' : 'blue';
  const targetMarker = goalMarkers.find((g) => g.team === targetTeam);
  const boostRatio = Math.max(0, Math.min(1, hud.boost / 100));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const arcFraction = 0.75; // 270-degree Rocket League gauge
  const arcLen = circumference * arcFraction;
  const dashOffset = arcLen * (1 - boostRatio);

  const countdownDigit =
    hud.phase === 'countdown' ? Math.max(1, Math.ceil(hud.phaseTimer)) : null;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Projected 3D Goal Labels ("SEGNA QUI" vs "TUA PORTA") */}
      {goalMarkers.map((g) => {
        if (!g.visible) return null;
        const isTarget = g.team === targetTeam;
        return (
          <div
            key={g.team}
            className="fixed -translate-x-1/2 -translate-y-full pointer-events-none"
            style={{ left: `${g.x}px`, top: `${Math.max(92, g.y)}px` }}
          >
            <div
              className={`px-2.5 py-0.5 rounded text-[11px] font-extrabold tracking-wide text-white shadow-lg border whitespace-nowrap hud-text-shadow ${
                isTarget
                  ? g.team === 'orange'
                    ? 'bg-orange-600/90 border-orange-300'
                    : 'bg-blue-600/90 border-sky-300'
                  : 'bg-[#0b101c]/80 border-white/25 text-slate-200'
              }`}
            >
              {isTarget
                ? `SEGNA QUI (${g.team === 'orange' ? 'ARANCIONE' : 'BLU'})`
                : `TUA PORTA (${g.team === 'blue' ? 'BLU' : 'ARANCIONE'})`}
            </div>
          </div>
        );
      })}

      {/* Projected 3D Car Nameplates */}
      {nameplates.map(
        (p) =>
          p.visible && (
            <div
              key={p.id}
              className="fixed -translate-x-1/2 -translate-y-full pointer-events-none"
              style={{ left: `${p.x}px`, top: `${p.y}px` }}
            >
              <div
                className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wide text-white hud-text-shadow whitespace-nowrap ${
                  p.team === 'blue' ? 'bg-blue-600/85' : 'bg-orange-600/85'
                }`}
              >
                {p.name}
              </div>
            </div>
          ),
      )}

      {/* Top-Center Scoreboard */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <div className="flex items-stretch rounded-lg overflow-hidden shadow-xl border border-white/15 bg-[#0b101c]/90">
          <div className="flex items-center gap-2.5 px-4 py-1.5 bg-blue-600 text-white">
            <span className="text-[11px] font-bold tracking-wider uppercase opacity-90">
              BLU
            </span>
            <span
              data-testid="score-blue"
              className="font-display font-extrabold text-2xl font-mono-nums leading-none"
            >
              {hud.scoreBlue}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center px-4 py-1 bg-[#0b101c] min-w-[92px]">
            <span
              data-testid="match-clock"
              className={`font-mono-nums font-bold text-xl leading-none ${
                hud.isOvertime ? 'text-amber-400' : 'text-white'
              }`}
            >
              {formatClock(hud.clockSeconds, hud.isOvertime)}
            </span>
            {hud.isOvertime && (
              <span className="text-[10px] font-bold tracking-wider text-amber-400 mt-0.5">
                SUPPLEMENTARI
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 px-4 py-1.5 bg-orange-600 text-white">
            <span
              data-testid="score-orange"
              className="font-display font-extrabold text-2xl font-mono-nums leading-none"
            >
              {hud.scoreOrange}
            </span>
            <span className="text-[11px] font-bold tracking-wider uppercase opacity-90">
              ARA
            </span>
          </div>
        </div>

        <div
          data-testid="team-objective-banner"
          className="mt-1.5 flex items-center gap-2 px-3 py-0.5 rounded bg-[#0b101c]/88 border border-white/15 text-[11px] font-semibold text-slate-200 shadow"
        >
          <span className={localTeam === 'blue' ? 'text-sky-400 font-bold' : 'text-orange-400 font-bold'}>
            SEI {localTeam === 'blue' ? 'BLU' : 'ARANCIONE'}
          </span>
          <span aria-hidden="true" className="text-slate-500">·</span>
          <span>
            SEGNA IN PORTA{' '}
            <strong className={targetTeam === 'orange' ? 'text-orange-400' : 'text-sky-400'}>
              {targetTeam === 'orange' ? 'ARANCIONE' : 'BLU'}
            </strong>
          </span>
          {targetMarker && !targetMarker.visible && (
            <span className={targetTeam === 'orange' ? 'text-orange-300 font-bold' : 'text-sky-300 font-bold'}>
              {targetMarker.side === 'left'
                ? '←'
                : targetMarker.side === 'right'
                  ? '→'
                  : '↻'}
            </span>
          )}
        </div>

        {roomCode && (
          <div className="mt-1 px-2.5 py-0.5 rounded bg-[#0b101c]/85 text-[11px] font-mono-nums text-slate-300 border border-white/10">
            STANZA: {roomCode}
          </div>
        )}
      </div>

      {/* Top-Right Compact Utility Buttons */}
      <div className="fixed top-4 right-4 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          tabIndex={-1}
          aria-label={muted ? 'Attiva Audio' : 'Silenzia Audio'}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          className="w-10 h-10 rounded-lg bg-[#0b101c]/90 hover:bg-[#1e293b] border border-white/15 flex items-center justify-center text-white cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Pausa"
          onClick={(e) => {
            e.currentTarget.blur();
            onTogglePause();
          }}
          className="w-10 h-10 rounded-lg bg-[#0b101c]/90 hover:bg-[#1e293b] border border-white/15 flex items-center justify-center text-white cursor-pointer"
        >
          <Pause className="w-4 h-4" />
        </button>
      </div>

      {/* Top-Left Live Feed & Quick Chat */}
      <div className="fixed top-4 left-4 flex flex-col gap-1.5 max-w-xs">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`px-3 py-1.5 rounded-md text-xs font-bold text-white shadow-md ${
              n.team === 'blue'
                ? 'bg-blue-600/90'
                : n.team === 'orange'
                  ? 'bg-orange-600/90'
                  : 'bg-[#0b101c]/90 border border-white/15'
            }`}
          >
            <span>{n.title}</span>{' '}
            <span className="font-normal opacity-90">{n.subtitle}</span>
          </div>
        ))}

        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className="px-2.5 py-1 rounded bg-[#0b101c]/85 border border-white/10 text-xs text-white"
          >
            <span
              className={`font-bold ${
                msg.team === 'blue' ? 'text-sky-400' : 'text-orange-400'
              }`}
            >
              {msg.playerName}:
            </span>{' '}
            <span>{msg.text}</span>
          </div>
        ))}
      </div>

      {/* Center Kickoff Countdown or Goal Celebration Banner */}
      {countdownDigit !== null && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
          <div className="font-display font-extrabold text-8xl text-white hud-text-shadow">
            {countdownDigit}
          </div>
        </div>
      )}

      {hud.phase === 'goal_scored' && (
        <div className="fixed inset-x-0 top-24 flex flex-col items-center pointer-events-none">
          <div
            className={`px-8 py-3 rounded-xl border border-white/25 shadow-2xl text-center ${
              hud.lastGoalTeam === 'blue' ? 'bg-blue-600/95' : 'bg-orange-600/95'
            }`}
          >
            <div className="font-display font-extrabold text-4xl tracking-wider text-white">
              GOL!
            </div>
            <div className="text-sm font-semibold text-white/95 mt-0.5">
              {hud.lastGoalScorer || 'Squadra'} ·{' '}
              <span className="font-mono-nums">{hud.lastGoalSpeedKph} km/h</span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom-Left Ball Cam Indicator + Quick Chat Bar */}
      <div className="fixed bottom-5 left-5 flex flex-col gap-2 pointer-events-auto">
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleBallCam();
          }}
          className={`px-3.5 py-1.5 rounded-lg border text-xs font-bold tracking-wide cursor-pointer w-fit ${
            hud.ballCam
              ? 'bg-sky-500/90 border-sky-300 text-slate-950'
              : 'bg-[#0b101c]/90 border-white/15 text-slate-200'
          }`}
        >
          {hud.ballCam ? 'BALL CAM [Y]' : 'CAR CAM [Y]'}
        </button>

        <div className="hidden md:flex items-center gap-1.5 bg-[#0b101c]/85 border border-white/10 rounded-lg px-2.5 py-1.5">
          {QUICK_CHAT_OPTIONS.map((text, idx) => (
            <button
              key={text}
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onQuickChat(idx);
              }}
              className="px-2 py-0.5 rounded hover:bg-white/10 text-[11px] text-slate-300 cursor-pointer whitespace-nowrap"
            >
              <span className="font-mono-nums text-sky-400">[{idx + 1}]</span> {text}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom-Right Iconic Rocket League Boost Gauge */}
      <div className="fixed bottom-5 right-5 flex flex-col items-center">
        <div className="relative w-32 h-32 flex items-center justify-center">
          <svg
            viewBox="0 0 112 112"
            className="w-full h-full rotate-[135deg]"
            aria-hidden="true"
          >
            {/* Background Track */}
            <circle
              cx="56"
              cy="56"
              r={radius}
              fill="rgba(11,16,28,0.86)"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="10"
              strokeDasharray={`${arcLen} ${circumference}`}
              strokeLinecap="round"
            />
            {/* Active Boost Fill */}
            <circle
              cx="56"
              cy="56"
              r={radius}
              fill="none"
              stroke={hud.boost > 75 ? '#fbbf24' : hud.boost > 25 ? '#f97316' : '#ef4444'}
              strokeWidth="10"
              strokeDasharray={`${arcLen} ${circumference}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
            <span
              data-testid="boost-value"
              className="font-display font-extrabold text-3xl text-white font-mono-nums leading-none hud-text-shadow"
            >
              {hud.boost}
            </span>
            <span className="text-[10px] font-bold tracking-wider text-amber-400 mt-0.5">
              TURBO
            </span>
            <span className="text-[11px] font-mono-nums text-slate-300 mt-1">
              {hud.speedKph} km/h
            </span>
          </div>
        </div>
        {hud.supersonic && (
          <div className="mt-1 px-2.5 py-0.5 rounded bg-sky-500 text-slate-950 font-display font-extrabold text-[10px] tracking-widest">
            SUPERSONICO
          </div>
        )}
      </div>

      {/* Tab Scoreboard Overlay */}
      {showScoreboard && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/55">
          <div className="w-full max-w-2xl bg-[#0b101c]/95 border border-white/15 rounded-xl p-5 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-white mb-3 text-center">
              Tabellone Partita
            </h3>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-white/10">
                  <th className="py-2">Giocatore</th>
                  <th className="py-2">Squadra</th>
                  <th className="py-2 text-right">Punti</th>
                  <th className="py-2 text-right">Gol</th>
                  <th className="py-2 text-right">Tiri</th>
                  <th className="py-2 text-right">Parate</th>
                  <th className="py-2 text-right">Demo</th>
                </tr>
              </thead>
              <tbody>
                {cars.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-white/5 ${
                      c.id === localPlayerId ? 'bg-white/10 font-bold text-white' : 'text-slate-200'
                    }`}
                  >
                    <td className="py-2">{c.name}</td>
                    <td
                      className={`py-2 font-semibold ${
                        c.team === 'blue' ? 'text-sky-400' : 'text-orange-400'
                      }`}
                    >
                      {c.team === 'blue' ? 'Blu' : 'Arancione'}
                    </td>
                    <td className="py-2 text-right font-mono-nums">{c.score}</td>
                    <td className="py-2 text-right font-mono-nums">{c.goals}</td>
                    <td className="py-2 text-right font-mono-nums">{c.shots}</td>
                    <td className="py-2 text-right font-mono-nums">{c.saves}</td>
                    <td className="py-2 text-right font-mono-nums">{c.demos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

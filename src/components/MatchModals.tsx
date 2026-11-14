import type { CarState, Team } from '../shared/types';

interface PauseModalProps {
  onResume: () => void;
  onRestart: () => void;
  onQuitToTitle: () => void;
  isMultiplayer: boolean;
}

export function PauseModal({
  onResume,
  onRestart,
  onQuitToTitle,
  isMultiplayer,
}: PauseModalProps) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
      <div className="w-full max-w-sm bg-[#0b101c] border border-white/15 rounded-xl p-6 shadow-2xl text-center">
        <h2 className="font-display text-2xl font-extrabold text-white mb-1">
          PARTITA IN PAUSA
        </h2>
        <p className="text-xs text-slate-400 mb-5">
          Premi Esc o P per riprendere subito
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-display font-extrabold text-sm cursor-pointer"
          >
            RIPRENDI
          </button>

          {!isMultiplayer && (
            <button
              type="button"
              onClick={onRestart}
              className="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-sm cursor-pointer"
            >
              Ricomincia Partita
            </button>
          )}

          <button
            type="button"
            onClick={onQuitToTitle}
            className="w-full py-2.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 font-semibold text-sm cursor-pointer"
          >
            Esci al Menu Principale
          </button>
        </div>
      </div>
    </div>
  );
}

interface MatchEndModalProps {
  winner: Team | null;
  scoreBlue: number;
  scoreOrange: number;
  cars: CarState[];
  localPlayerId: string;
  onRematch: () => void;
  onQuitToTitle: () => void;
}

export function MatchEndModal({
  winner,
  scoreBlue,
  scoreOrange,
  cars,
  localPlayerId,
  onRematch,
  onQuitToTitle,
}: MatchEndModalProps) {
  const localCar = cars.find((c) => c.id === localPlayerId);
  const localWon = localCar && winner === localCar.team;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg bg-[#0b101c] border border-white/15 rounded-xl p-6 shadow-2xl">
        <div className="text-center mb-5">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
            Fine Partita
          </div>
          <h2
            className={`font-display text-3xl font-extrabold ${
              winner === 'blue' ? 'text-sky-400' : 'text-orange-400'
            }`}
          >
            {localCar
              ? localWon
                ? 'VITTORIA!'
                : 'SCONFITTA'
              : winner === 'blue'
                ? 'VINCE SQUADRA BLU!'
                : 'VINCE SQUADRA ARANCIONE!'}
          </h2>
          <div className="flex items-center justify-center gap-4 mt-3 font-display text-4xl font-extrabold font-mono-nums">
            <span className="text-sky-400">{scoreBlue}</span>
            <span className="text-slate-500 text-2xl">-</span>
            <span className="text-orange-400">{scoreOrange}</span>
          </div>
        </div>

        {/* Stat Tiles */}
        {localCar && (
          <div className="grid grid-cols-4 gap-2 mb-5">
            <div className="p-2.5 rounded-lg bg-[#111827] text-center">
              <div className="font-mono-nums text-xl font-bold text-white">
                {localCar.score}
              </div>
              <div className="text-[11px] text-slate-400">Punti</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[#111827] text-center">
              <div className="font-mono-nums text-xl font-bold text-white">
                {localCar.goals}
              </div>
              <div className="text-[11px] text-slate-400">Gol</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[#111827] text-center">
              <div className="font-mono-nums text-xl font-bold text-white">
                {localCar.shots}
              </div>
              <div className="text-[11px] text-slate-400">Tiri</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[#111827] text-center">
              <div className="font-mono-nums text-xl font-bold text-white">
                {localCar.saves}
              </div>
              <div className="text-[11px] text-slate-400">Parate</div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onRematch}
            className="flex-1 py-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-display font-extrabold text-sm cursor-pointer"
          >
            RIVINCITA
          </button>
          <button
            type="button"
            onClick={onQuitToTitle}
            className="flex-1 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-sm cursor-pointer"
          >
            Menu Principale
          </button>
        </div>
      </div>
    </div>
  );
}

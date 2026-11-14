import type { CarCustomization } from '../shared/types';

interface GarageModalProps {
  customization: CarCustomization;
  onChange: (next: CarCustomization) => void;
  onClose: () => void;
}

const COLOR_PRESETS = [
  { label: 'Blu Elettrico', value: '#1d4ed8' },
  { label: 'Ciano', value: '#0284c7' },
  { label: 'Arancio Fuoco', value: '#ea580c' },
  { label: 'Rosso Corsa', value: '#dc2626' },
  { label: 'Verde Smeraldo', value: '#059669' },
  { label: 'Viola', value: '#7c3aed' },
];

const ACCENT_PRESETS = [
  { label: 'Celeste', value: '#38bdf8' },
  { label: 'Oro', value: '#fbbf24' },
  { label: 'Bianco', value: '#f8fafc' },
  { label: 'Lime', value: '#84cc16' },
  { label: 'Corallo', value: '#fb7185' },
];

export function GarageModal({ customization, onChange, onClose }: GarageModalProps) {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex items-center p-6 md:p-10">
      <div className="pointer-events-auto w-full max-w-sm bg-[#0b101c]/95 border border-white/15 rounded-xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-bold text-white">Garage Auto</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-semibold text-white cursor-pointer"
          >
            Salva e Chiudi
          </button>
        </div>

        {/* Chassis */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Telaio</span>
          <div className="grid grid-cols-2 gap-2">
            {(['octane', 'dominus'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => onChange({ ...customization, body: b })}
                className={`py-2 px-3 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                  customization.body === b
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {b === 'octane' ? 'Octane Turbo' : 'Dominus GT'}
              </button>
            ))}
          </div>
        </div>

        {/* Decal */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Livrea</span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'stripes', label: 'Strisce' },
                { id: 'flames', label: 'Fiamme' },
                { id: 'clean', label: 'Pulita' },
              ] as const
            ).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onChange({ ...customization, decal: d.id })}
                className={`py-2 px-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  customization.decal === d.id
                    ? 'bg-orange-500 text-slate-950'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Primary Color */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Colore Carrozzeria
          </span>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.label}
                onClick={() => onChange({ ...customization, primaryColor: c.value })}
                className={`w-8 h-8 rounded-lg border-2 cursor-pointer ${
                  customization.primaryColor === c.value
                    ? 'border-white scale-110'
                    : 'border-white/20'
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </div>

        {/* Accent & Boost Color */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Finitura &amp; Fiamma Turbo
          </span>
          <div className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={`Accento ${c.label}`}
                onClick={() =>
                  onChange({ ...customization, accentColor: c.value, boostColor: c.value })
                }
                className={`w-8 h-8 rounded-lg border-2 cursor-pointer ${
                  customization.accentColor === c.value
                    ? 'border-white scale-110'
                    : 'border-white/20'
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </div>

        {/* Wheels */}
        <div>
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Cerchioni</span>
          <div className="grid grid-cols-2 gap-2">
            {(['sport', 'aero'] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onChange({ ...customization, wheelStyle: w })}
                className={`py-2 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                  customization.wheelStyle === w
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {w === 'sport' ? 'Cromati Sport' : 'Aero Verniciati'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

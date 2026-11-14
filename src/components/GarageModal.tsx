import type {
  CarBodyStyle,
  CarCustomization,
  DecalStyle,
  PaintFinish,
  TopperStyle,
  WheelStyle,
} from '../shared/types';
import { DEFAULT_CUSTOMIZATION_BLUE } from '../shared/types';

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
  { label: 'Rosa Neon', value: '#db2777' },
  { label: 'Nero Grafite', value: '#1e293b' },
];

const ACCENT_PRESETS = [
  { label: 'Celeste', value: '#38bdf8' },
  { label: 'Oro', value: '#fbbf24' },
  { label: 'Bianco', value: '#f8fafc' },
  { label: 'Lime', value: '#84cc16' },
  { label: 'Corallo', value: '#fb7185' },
  { label: 'Viola Plasma', value: '#c084fc' },
  { label: 'Arancio', value: '#fb923c' },
];

const BOOST_PRESETS = [
  { label: 'Turbo Blu', value: '#38bdf8' },
  { label: 'Turbo Fuoco', value: '#f97316' },
  { label: 'Turbo Oro', value: '#facc15' },
  { label: 'Turbo Verde', value: '#4ade80' },
  { label: 'Turbo Plasma', value: '#c084fc' },
  { label: 'Turbo Cremisi', value: '#f43f5e' },
  { label: 'Turbo Bianco', value: '#f8fafc' },
];

const BODIES: Array<{ id: CarBodyStyle; label: string }> = [
  { id: 'octane', label: 'Octane Turbo' },
  { id: 'dominus', label: 'Dominus GT' },
  { id: 'fennec', label: 'Fennec RS' },
];

const FINISHES: Array<{ id: PaintFinish; label: string }> = [
  { id: 'metallic', label: 'Metallizzata' },
  { id: 'gloss', label: 'Lucida' },
  { id: 'matte', label: 'Opaca' },
  { id: 'anodized', label: 'Anodizzata' },
];

const DECALS: Array<{ id: DecalStyle; label: string }> = [
  { id: 'stripes', label: 'Strisce' },
  { id: 'flames', label: 'Fiamme' },
  { id: 'cyber', label: 'Cyber' },
  { id: 'wings', label: 'Ali Apex' },
  { id: 'clean', label: 'Pulita' },
];

const TOPPERS: Array<{ id: TopperStyle; label: string }> = [
  { id: 'none', label: 'Nessuno' },
  { id: 'halo', label: 'Halo Neon' },
  { id: 'crown', label: 'Corona' },
  { id: 'fin', label: 'Pinna Aero' },
];

const WHEELS: Array<{ id: WheelStyle; label: string }> = [
  { id: 'sport', label: 'Sport' },
  { id: 'aero', label: 'Aero' },
  { id: 'turbine', label: 'Turbina' },
  { id: 'cyber', label: 'Cyber Neon' },
];

const GARAGE_PRESETS: Array<CarCustomization & { label: string }> = [
  { label: 'Rally', primaryColor: '#14532d', accentColor: '#facc15', boostColor: '#facc15', body: 'fennec', decal: 'stripes', wheelStyle: 'sport', paintFinish: 'matte', topper: 'none', underglow: false, spoiler: 'ducktail', wheelColor: '#facc15' },
  { label: 'Midnight', primaryColor: '#172554', accentColor: '#22d3ee', boostColor: '#22d3ee', body: 'dominus', decal: 'cyber', wheelStyle: 'cyber', paintFinish: 'anodized', topper: 'fin', underglow: true, spoiler: 'sport', wheelColor: '#22d3ee' },
  { label: 'Supernova', primaryColor: '#9f1239', accentColor: '#f8fafc', boostColor: '#fb923c', body: 'octane', decal: 'flames', wheelStyle: 'turbine', paintFinish: 'gloss', topper: 'halo', underglow: true, spoiler: 'sport', wheelColor: '#f8fafc' },
];

export function GarageModal({ customization, onChange, onClose }: GarageModalProps) {
  const paintFinish = customization.paintFinish ?? 'metallic';
  const topper = customization.topper ?? 'none';
  const underglow = Boolean(customization.underglow);

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex items-end md:items-center p-4 md:p-8">
      <div className="pointer-events-auto w-full max-w-md max-h-[55vh] md:max-h-[88vh] overflow-y-auto bg-[#0b101c]/95 border border-white/15 rounded-xl p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-2 mb-4 sticky top-0 bg-[#0b101c]/95 pb-2 border-b border-white/10 z-10">
          <h2 className="font-display text-xl font-bold text-white">Garage Auto</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_CUSTOMIZATION_BLUE })}
              className="px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/15 text-[11px] font-semibold text-slate-300 cursor-pointer"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-400 text-xs font-extrabold text-slate-950 cursor-pointer"
            >
              Salva e Chiudi
            </button>
          </div>
        </div>

        {/* Chassis */}
        <div className="mb-5">
          <p className="text-xs text-slate-400 mb-2">Trascina l’auto per ruotare · rotella per zoomare. Modifiche salvate automaticamente.</p>
          <div className="grid grid-cols-3 gap-2">
            {GARAGE_PRESETS.map(({ label, ...preset }) => (
              <button type="button" key={label} onClick={() => onChange(preset)} className="rounded-lg border border-white/15 bg-white/5 py-2 text-xs font-bold text-white hover:bg-white/15 cursor-pointer">{label}</button>
            ))}
          </div>
        </div>
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Telaio</span>
          <div className="grid grid-cols-3 gap-1.5">
            {BODIES.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onChange({ ...customization, body: b.id })}
                className={`py-2 px-2 rounded-lg text-xs font-bold uppercase cursor-pointer ${
                  customization.body === b.id
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Paint Finish */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Finitura Vernice
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {FINISHES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onChange({ ...customization, paintFinish: f.id })}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                  paintFinish === f.id
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Decal */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Livrea</span>
          <div className="grid grid-cols-5 gap-1.5">
            {DECALS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onChange({ ...customization, decal: d.id })}
                className={`py-1.5 px-1 rounded-lg text-[11px] font-semibold cursor-pointer truncate ${
                  customization.decal === d.id
                    ? 'bg-orange-500 text-slate-950 font-bold'
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
          <div className="flex flex-wrap items-center gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.label}
                onClick={() => onChange({ ...customization, primaryColor: c.value })}
                className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                  customization.primaryColor === c.value
                    ? 'border-white scale-110'
                    : 'border-white/20'
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
            <label
              className="w-7 h-7 rounded-lg border-2 border-white/30 overflow-hidden cursor-pointer flex items-center justify-center bg-white/5 text-[10px] font-bold text-slate-200"
              title="Colore personalizzato"
            >
              <span>+</span>
              <input
                type="color"
                aria-label="Colore Carrozzeria Personalizzato"
                value={customization.primaryColor}
                onChange={(e) => onChange({ ...customization, primaryColor: e.target.value })}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {/* Accent Color */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Colore Accenti, Cerchioni &amp; Topper
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={`Accento ${c.label}`}
                onClick={() => onChange({ ...customization, accentColor: c.value })}
                className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                  customization.accentColor === c.value
                    ? 'border-white scale-110'
                    : 'border-white/20'
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
            <label
              className="w-7 h-7 rounded-lg border-2 border-white/30 overflow-hidden cursor-pointer flex items-center justify-center bg-white/5 text-[10px] font-bold text-slate-200"
              title="Colore accento personalizzato"
            >
              <span>+</span>
              <input
                type="color"
                aria-label="Colore Accento Personalizzato"
                value={customization.accentColor}
                onChange={(e) => onChange({ ...customization, accentColor: e.target.value })}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {/* Boost Flame Color (Independent) */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Colore Fiamma Turbo
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {BOOST_PRESETS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.label}
                onClick={() => onChange({ ...customization, boostColor: c.value })}
                className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                  customization.boostColor === c.value
                    ? 'border-white scale-110'
                    : 'border-white/20'
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </div>

        {/* Roof Topper */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">
            Accessorio Tetto (Topper)
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {TOPPERS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange({ ...customization, topper: t.id })}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                  topper === t.id
                    ? 'bg-orange-500 text-slate-950 font-bold'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Wheels */}
        <div className="mb-4">
          <span className="block text-xs font-semibold text-slate-300 mb-1.5">Cerchioni</span>
          <div className="grid grid-cols-4 gap-1.5">
            {WHEELS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onChange({ ...customization, wheelStyle: w.id })}
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                  customization.wheelStyle === w.id
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Neon Underglow */}
        <div className="mb-4 flex items-center justify-between">
          <label htmlFor="wheel-color" className="text-xs font-semibold text-slate-300">Colore cerchioni indipendente</label>
          <input id="wheel-color" type="color" value={customization.wheelColor ?? customization.accentColor} onChange={(e) => onChange({ ...customization, wheelColor: e.target.value })} className="w-10 h-8 cursor-pointer rounded bg-transparent" />
        </div>
        <div className="mb-4">
          <label htmlFor="spoiler-style" className="block text-xs font-semibold text-slate-300 mb-2">Spoiler</label>
          <select id="spoiler-style" value={customization.spoiler ?? 'sport'} onChange={(e) => onChange({ ...customization, spoiler: e.target.value as CarCustomization['spoiler'] })} className="w-full rounded-lg border border-white/15 bg-slate-900 p-2 text-xs text-white">
            <option value="sport">Ala sportiva</option>
            <option value="ducktail">Ducktail compatto</option>
            <option value="none">Senza spoiler</option>
          </select>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <span className="text-xs font-semibold text-slate-300">Neon Sottoscocca</span>
          <button
            type="button"
            onClick={() => onChange({ ...customization, underglow: !underglow })}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              underglow
                ? 'bg-sky-500 text-slate-950'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {underglow ? 'Attivo' : 'Disattivo'}
          </button>
        </div>
      </div>
    </div>
  );
}

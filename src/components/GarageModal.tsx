import { useState } from 'react';
import {
  ACCENT_PRESETS,
  BODY_GEOMETRY_SPECS,
  BOOST_EFFECT_OPTIONS,
  BOOST_PRESETS,
  CAR_BODY_LIST,
  COLOR_PRESETS,
  DECAL_OPTIONS,
  GARAGE_PRESETS,
  HEADLIGHT_PRESETS,
  PAINT_FINISH_OPTIONS,
  SPOILER_OPTIONS,
  TOPPER_OPTIONS,
  TRIM_OPTIONS,
  WHEEL_OPTIONS,
  WINDOW_TINT_OPTIONS,
  randomizeCarCustomization,
} from '../shared/customization';
import type { CarCustomization } from '../shared/types';
import { DEFAULT_CUSTOMIZATION_BLUE } from '../shared/types';

interface GarageModalProps {
  customization: CarCustomization;
  onChange: (next: CarCustomization) => void;
  onFocusView?: (focus: 'front' | 'rear') => void;
  onClose: () => void;
}

type GarageTab = 'chassis' | 'paint' | 'livery' | 'wheels' | 'boost';

const TABS: Array<{ id: GarageTab; label: string }> = [
  { id: 'chassis', label: 'Telaio' },
  { id: 'paint', label: 'Vernice' },
  { id: 'livery', label: 'Livrea' },
  { id: 'wheels', label: 'Ruote' },
  { id: 'boost', label: 'Fumo' },
];

function SwatchRow({
  label,
  value,
  presets,
  onSelect,
  pickerLabel,
}: {
  label: string;
  value: string;
  presets: Array<{ label: string; value: string }>;
  onSelect: (hex: string) => void;
  pickerLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        <span className="font-mono text-[11px] text-slate-400 uppercase">{value}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-label={c.label}
            title={c.label}
            onClick={() => onSelect(c.value)}
            className={`w-7 h-7 rounded-md border-2 transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
              value.toLowerCase() === c.value.toLowerCase()
                ? 'border-white scale-110'
                : 'border-white/20 hover:border-white/50'
            }`}
            style={{ backgroundColor: c.value }}
          />
        ))}
        <label
          className="w-7 h-7 rounded-md border-2 border-white/30 overflow-hidden cursor-pointer flex items-center justify-center bg-white/5 hover:bg-white/15 text-[11px] font-bold text-slate-200"
          title={pickerLabel}
        >
          <span>+</span>
          <input
            type="color"
            aria-label={pickerLabel}
            value={value}
            onChange={(e) => onSelect(e.target.value)}
            className="sr-only"
          />
        </label>
      </div>
    </div>
  );
}

export function GarageModal({ customization, onChange, onFocusView, onClose }: GarageModalProps) {
  const [activeTab, setActiveTab] = useState<GarageTab>('chassis');

  const handleSelectTab = (tab: GarageTab) => {
    setActiveTab(tab);
    onFocusView?.(tab === 'boost' ? 'rear' : 'front');
  };

  const paintFinish = customization.paintFinish ?? 'metallic';
  const topper = customization.topper ?? 'none';
  const spoiler = customization.spoiler ?? 'sport';
  const underglow = Boolean(customization.underglow);
  const underglowColor = customization.underglowColor ?? customization.accentColor;
  const wheelColor = customization.wheelColor ?? customization.accentColor;
  const windowTint = customization.windowTint ?? 'dark';
  const trimStyle = customization.trimStyle ?? 'carbon';
  const headlightColor = customization.headlightColor ?? '#e0f2fe';
  const boostEffect = customization.boostEffect ?? 'classic_flame';
  const activeBodySpec = BODY_GEOMETRY_SPECS[customization.body] ?? BODY_GEOMETRY_SPECS.octane;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex items-end md:items-center p-3 md:p-7">
      <div className="pointer-events-auto w-full max-w-[448px] max-h-[56vh] md:max-h-[89vh] flex flex-col bg-[#0b101c]/95 border border-white/15 rounded-xl shadow-2xl overflow-hidden">
        {/* Sticky Header */}
        <div className="px-5 pt-4 pb-3 border-b border-white/10 bg-[#0b101c]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-extrabold text-white leading-tight">
                Garage Auto 3D
              </h2>
              <p className="text-[11px] text-slate-400">
                {activeBodySpec.label} · Trascina e zooma l’auto 3D
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onChange(randomizeCarCustomization())}
                className="px-2.5 py-2 rounded-md bg-sky-500/15 hover:bg-sky-500/30 border border-sky-400/35 text-[11px] font-bold text-sky-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                Casuale
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...DEFAULT_CUSTOMIZATION_BLUE })}
                className="px-2.5 py-2 rounded-md bg-white/5 hover:bg-white/15 text-[11px] font-semibold text-slate-300 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-400 text-xs font-extrabold text-slate-950 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
              >
                Salva
              </button>
            </div>
          </div>

          {/* Quick Curated Presets */}
          <div className="grid grid-cols-4 gap-1.5 mt-3">
            {GARAGE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => onChange({ ...preset.config })}
                className="py-1.5 px-1.5 rounded-md border border-white/12 bg-white/5 hover:bg-white/15 text-[11px] font-bold text-slate-100 truncate cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Category Tabs */}
          <div
            role="tablist"
            aria-label="Sezioni personalizzazione auto"
            className="grid grid-cols-5 gap-1 p-1 mt-3 rounded-lg bg-slate-950/80 border border-white/10"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={activeTab === tab.id}
                onClick={() => handleSelectTab(tab.id)}
                className={`py-2 px-1 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                  activeTab === tab.id
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Tab Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {activeTab === 'chassis' && (
            <>
              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Scocca / Archetipo Veicolo
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {CAR_BODY_LIST.map((b) => {
                    const selected = customization.body === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onChange({ ...customization, body: b.id })}
                        className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                          selected
                            ? 'bg-sky-500/20 border-sky-400 text-white'
                            : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <div className="text-xs font-extrabold uppercase tracking-wide flex items-center justify-between">
                          <span>{b.label}</span>
                          {selected && <span className="text-[10px] text-sky-300">ATTIVO</span>}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {b.tagline}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Alettone Posteriore (Spoiler)
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {SPOILER_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChange({ ...customization, spoiler: s.id })}
                      className={`py-2 px-2 rounded-md text-[11px] font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        spoiler === s.id
                          ? 'bg-orange-500 text-slate-950'
                          : 'bg-white/5 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Accessorio Tetto (Topper)
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {TOPPER_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onChange({ ...customization, topper: t.id })}
                      className={`py-2 px-2 rounded-md text-[11px] font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        topper === t.id
                          ? 'bg-sky-500 text-slate-950'
                          : 'bg-white/5 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === 'paint' && (
            <>
              <SwatchRow
                label="Colore Carrozzeria"
                value={customization.primaryColor}
                presets={COLOR_PRESETS}
                pickerLabel="Colore Carrozzeria Personalizzato"
                onSelect={(hex) => onChange({ ...customization, primaryColor: hex })}
              />

              <SwatchRow
                label="Colore Accenti, Alettone & Dettagli"
                value={customization.accentColor}
                presets={ACCENT_PRESETS}
                pickerLabel="Colore Accento Personalizzato"
                onSelect={(hex) => onChange({ ...customization, accentColor: hex })}
              />

              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Finitura Vernice
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {PAINT_FINISH_OPTIONS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onChange({ ...customization, paintFinish: f.id })}
                      className={`py-2 px-2 rounded-md text-[11px] font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        paintFinish === f.id
                          ? 'bg-sky-500 text-slate-950'
                          : 'bg-white/5 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Materiale Componenti Aero / Bull-Bar
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {TRIM_OPTIONS.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      onClick={() => onChange({ ...customization, trimStyle: tr.id })}
                      className={`py-2 px-2 rounded-md text-[11px] font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        trimStyle === tr.id
                          ? 'bg-orange-500 text-slate-950'
                          : 'bg-white/5 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {tr.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === 'livery' && (
            <>
              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Livrea Grafica
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {DECAL_OPTIONS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onChange({ ...customization, decal: d.id })}
                      className={`py-2 px-1.5 rounded-md text-[11px] font-bold truncate cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        customization.decal === d.id
                          ? 'bg-orange-500 text-slate-950'
                          : 'bg-white/5 text-slate-300 hover:bg-white/12'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Tinta Vetri / Visiera
                </span>
                <div className="grid grid-cols-5 gap-1.5">
                  {WINDOW_TINT_OPTIONS.map((wt) => (
                    <button
                      key={wt.id}
                      type="button"
                      onClick={() => onChange({ ...customization, windowTint: wt.id })}
                      className={`py-2 px-1 rounded-md border text-[10px] font-bold flex flex-col items-center gap-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        windowTint === wt.id
                          ? 'border-sky-400 bg-sky-500/20 text-white'
                          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded-sm border border-white/30"
                        style={{ backgroundColor: wt.swatch }}
                      />
                      <span className="truncate w-full text-center">{wt.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <SwatchRow
                label="Colore Fari LED"
                value={headlightColor}
                presets={HEADLIGHT_PRESETS}
                pickerLabel="Colore Fari Personalizzato"
                onSelect={(hex) => onChange({ ...customization, headlightColor: hex })}
              />

              <div className="pt-2 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Neon Sottoscocca</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...customization, underglow: !underglow })}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                      underglow
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-white/5 text-slate-300 hover:bg-white/12'
                    }`}
                  >
                    {underglow ? 'Attivo' : 'Disattivo'}
                  </button>
                </div>

                {underglow && (
                  <SwatchRow
                    label="Colore Neon Sottoscocca"
                    value={underglowColor}
                    presets={ACCENT_PRESETS}
                    pickerLabel="Colore Neon Sottoscocca Personalizzato"
                    onSelect={(hex) => onChange({ ...customization, underglowColor: hex })}
                  />
                )}
              </div>
            </>
          )}

          {activeTab === 'wheels' && (
            <>
              <div>
                <span className="block text-xs font-semibold text-slate-300 mb-2">
                  Design Cerchioni &amp; Pneumatici
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {WHEEL_OPTIONS.map((w) => {
                    const selected = customization.wheelStyle === w.id;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => onChange({ ...customization, wheelStyle: w.id })}
                        className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                          selected
                            ? 'bg-sky-500/20 border-sky-400 text-white'
                            : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <div className="text-xs font-extrabold">{w.label}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{w.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <SwatchRow
                label="Colore Cerchioni Indipendente"
                value={wheelColor}
                presets={ACCENT_PRESETS}
                pickerLabel="Colore Cerchioni Personalizzato"
                onSelect={(hex) => onChange({ ...customization, wheelColor: hex })}
              />
            </>
          )}

          {activeTab === 'boost' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300">
                    Effetto Fumo &amp; Scia Turbo
                  </span>
                  <span className="text-[11px] text-sky-300 font-semibold">
                    Vista scarichi live
                  </span>
                </div>
                <div className="space-y-2">
                  {BOOST_EFFECT_OPTIONS.map((fx) => {
                    const selected = boostEffect === fx.id;
                    return (
                      <button
                        key={fx.id}
                        type="button"
                        onClick={() => onChange({ ...customization, boostEffect: fx.id })}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors flex items-center gap-3 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 ${
                          selected
                            ? 'bg-sky-500/20 border-sky-400 text-white'
                            : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <div
                          className="w-11 h-9 rounded-md border border-white/25 shrink-0"
                          style={{
                            background: `linear-gradient(135deg, ${fx.swatchColors[0]} 0%, ${fx.swatchColors[1]} 52%, ${fx.swatchColors[2]} 100%)`,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-extrabold uppercase tracking-wide flex items-center justify-between gap-2">
                            <span className="truncate">{fx.label}</span>
                            {selected && (
                              <span className="text-[10px] text-sky-300 shrink-0">ATTIVO</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            {fx.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <SwatchRow
                label="Colore Fumo &amp; Turbo"
                value={customization.boostColor}
                presets={BOOST_PRESETS}
                pickerLabel="Colore Fumo & Turbo Personalizzato"
                onSelect={(hex) => onChange({ ...customization, boostColor: hex })}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

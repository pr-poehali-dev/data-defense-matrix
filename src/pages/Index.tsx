import { useState, useCallback } from "react";
import Icon from "@/components/ui/icon";

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = "upload" | "matrix" | "analysis" | "optimization" | "report" | "settings";

interface MatrixData {
  size: number;
  probabilities: number[][];
  costs: number[][];
  mechanisms: string[];
  threshold: number;
}

interface OptResult {
  optimalSet: number[];
  optCost: number;
  optProb: number;
  delta: number;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO: MatrixData = {
  size: 5,
  mechanisms: ["Криптография", "Аутентификация", "Брандмауэр", "IDS/IPS", "VPN"],
  threshold: 0.92,
  probabilities: [
    [0.95, 0.88, 0.72, 0.61, 0.54],
    [0.89, 0.93, 0.81, 0.70, 0.66],
    [0.76, 0.82, 0.90, 0.85, 0.78],
    [0.63, 0.71, 0.84, 0.91, 0.88],
    [0.55, 0.65, 0.77, 0.86, 0.94],
  ],
  costs: [
    [120, 95, 70, 55, 40],
    [95, 140, 85, 65, 50],
    [70, 85, 160, 110, 80],
    [55, 65, 110, 175, 130],
    [40, 50, 80, 130, 190],
  ],
};

// ─── Algorithms ───────────────────────────────────────────────────────────────

function computeSystemProb(data: MatrixData, selected: number[]): number {
  if (selected.length === 0) return 0;
  let p = 1;
  for (const i of selected) {
    for (const j of selected) {
      p *= data.probabilities[i][j];
    }
  }
  return Math.pow(p, 1 / (selected.length * selected.length));
}

function computeSystemCost(data: MatrixData, selected: number[]): number {
  return selected.reduce((sum, i) => {
    return sum + selected.reduce((s, j) => s + data.costs[i][j], 0);
  }, 0);
}

function optimize(data: MatrixData): OptResult {
  const n = data.size;
  let best: OptResult = { optimalSet: [], optCost: Infinity, optProb: 0, delta: 0 };
  for (let mask = 1; mask < (1 << n); mask++) {
    const sel: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sel.push(i);
    const prob = computeSystemProb(data, sel);
    if (prob >= data.threshold) {
      const cost = computeSystemCost(data, sel);
      const delta = prob / (cost || 1);
      if (cost < best.optCost) {
        best = { optimalSet: sel, optCost: cost, optProb: prob, delta };
      }
    }
  }
  return best;
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function StatCard({ label, value, unit, color = "blue" }: { label: string; value: string | number; unit?: string; color?: "blue" | "accent" | "green" | "orange" }) {
  const colors: Record<string, string> = {
    blue: "text-primary",
    accent: "text-accent",
    green: "text-emerald-400",
    orange: "text-amber-400",
  };
  return (
    <div className="panel p-4 flex flex-col gap-1">
      <span className="label-xs">{label}</span>
      <span className={`stat-value ${colors[color]}`}>
        {value}
        {unit && <span className="text-sm text-muted-foreground ml-1">{unit}</span>}
      </span>
    </div>
  );
}

function HeatCell({ value, max, type }: { value: number; max: number; type: "prob" | "cost" }) {
  const ratio = value / max;
  const bg = type === "prob"
    ? `rgba(56, 189, 248, ${0.08 + ratio * 0.55})`
    : `rgba(239, 68, 68, ${0.06 + ratio * 0.45})`;
  return (
    <td
      className="text-center font-mono text-xs px-2 py-1.5 cell-hover border border-border/30 min-w-[64px]"
      style={{ background: bg }}
    >
      {type === "prob" ? value.toFixed(2) : value}
    </td>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function UploadSection({ data, onLoad }: { data: MatrixData; onLoad: (d: MatrixData) => void }) {
  const [dragging, setDragging] = useState(false);

  const handleDemoLoad = () => onLoad(DEMO);

  const handleJsonPaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const parsed = JSON.parse(e.target.value);
      if (parsed.probabilities && parsed.costs) onLoad(parsed as MatrixData);
    } catch (_e) { void _e; }
  };

  return (
    <div className="animate-slide-up space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Загрузка данных</h2>
        <p className="text-sm text-muted-foreground">Загрузите параметры системы защиты или используйте демонстрационные данные</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          className={`panel p-8 flex flex-col items-center justify-center gap-3 border-2 border-dashed cursor-pointer transition-all duration-200 ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (ev) => {
                try { const d = JSON.parse(ev.target?.result as string); onLoad(d); } catch (_e) { void _e; }
              };
              reader.readAsText(file);
            }
          }}
        >
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon name="Upload" size={22} className="text-primary" />
          </div>
          <div className="text-center">
            <p className="font-medium text-sm">Перетащите JSON-файл</p>
            <p className="text-xs text-muted-foreground mt-1">Поддерживается формат MatrixShield JSON</p>
          </div>
        </div>

        <div className="panel p-5 flex flex-col gap-3">
          <span className="label-xs">Вставить JSON напрямую</span>
          <textarea
            className="flex-1 bg-background border border-border rounded text-xs font-mono p-3 resize-none text-muted-foreground focus:outline-none focus:border-primary/50 min-h-[120px]"
            placeholder='{"size": 5, "probabilities": [...], "costs": [...]}'
            onChange={handleJsonPaste}
          />
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Демонстрационный набор данных</h3>
            <p className="text-xs text-muted-foreground mt-0.5">5 механизмов защиты: криптография, аутентификация, брандмауэр, IDS/IPS, VPN</p>
          </div>
          <button
            onClick={handleDemoLoad}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Icon name="Play" size={14} />
            Загрузить демо
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">Механизмов</span>
            <span className="font-mono font-semibold text-foreground">5</span>
          </div>
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">Порог вероятности</span>
            <span className="font-mono font-semibold text-foreground">0.92</span>
          </div>
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">Комбинаций</span>
            <span className="font-mono font-semibold text-foreground">31</span>
          </div>
        </div>
      </div>

      {data !== DEMO && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-2">
          <Icon name="CheckCircle" size={14} />
          Данные загружены: {data.size} механизмов защиты
        </div>
      )}
    </div>
  );
}

function MatrixSection({ data }: { data: MatrixData }) {
  const [view, setView] = useState<"prob" | "cost">("prob");
  const maxP = Math.max(...data.probabilities.flat());
  const maxC = Math.max(...data.costs.flat());

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">Матрицы системы</h2>
          <p className="text-sm text-muted-foreground">Тепловая карта значений вероятностей и стоимостей</p>
        </div>
        <div className="flex gap-1 bg-muted rounded p-1">
          <button
            onClick={() => setView("prob")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${view === "prob" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Вероятности
          </button>
          <button
            onClick={() => setView("cost")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${view === "cost" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Стоимости
          </button>
        </div>
      </div>

      <div className="panel p-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-xs text-muted-foreground font-medium min-w-[140px]"></th>
              {data.mechanisms.map((m, i) => (
                <th key={i} className="text-center px-2 py-1.5 text-xs text-muted-foreground font-medium min-w-[64px]">{m.slice(0, 6)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.mechanisms.map((row, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5 text-xs font-medium text-foreground/80">{row}</td>
                {(view === "prob" ? data.probabilities[i] : data.costs[i]).map((val, j) => (
                  <HeatCell key={j} value={val} max={view === "prob" ? maxP : maxC} type={view} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-16 h-3 rounded" style={{ background: "linear-gradient(to right, rgba(56,189,248,0.08), rgba(56,189,248,0.6))" }} />
          <span>{view === "prob" ? "Низкая → Высокая вероятность" : "Низкая → Высокая стоимость"}</span>
        </div>
        <span className="font-mono">{view === "prob" ? `Макс: ${maxP.toFixed(3)}` : `Макс: ${maxC}`}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.mechanisms.map((m, i) => {
          const avgP = data.probabilities[i].reduce((s, v) => s + v, 0) / data.size;
          const totalC = data.costs[i].reduce((s, v) => s + v, 0);
          return (
            <div key={i} className="panel p-3">
              <span className="label-xs block mb-2">{m}</span>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Ср. вер.</span>
                  <span className="font-mono text-primary">{avgP.toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Стоимость</span>
                  <span className="font-mono text-amber-400">{totalC}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisSection({ data }: { data: MatrixData }) {
  const [selected, setSelected] = useState<number[]>([0, 1, 2]);

  const toggleMech = (i: number) => {
    setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  };

  const prob = selected.length > 0 ? computeSystemProb(data, selected) : 0;
  const cost = selected.length > 0 ? computeSystemCost(data, selected) : 0;
  const delta = prob / (cost || 1);
  const meetsThreshold = prob >= data.threshold;

  const variants = [
    { label: "Минимальная", mech: [0] },
    { label: "Базовая", mech: [0, 1] },
    { label: "Расширенная", mech: [0, 1, 2] },
    { label: "Полная", mech: [0, 1, 2, 3, 4] },
  ];

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Анализ вариантов</h2>
        <p className="text-sm text-muted-foreground">Выберите механизмы для интерактивного сравнения</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="panel p-4 space-y-2">
          <span className="label-xs block mb-3">Активные механизмы</span>
          {data.mechanisms.map((m, i) => (
            <button
              key={i}
              onClick={() => toggleMech(i)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all duration-150 ${selected.includes(i) ? "bg-primary/15 border border-primary/30 text-foreground" : "bg-muted/40 border border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${selected.includes(i) ? "bg-primary" : "bg-border"}`}>
                {selected.includes(i) && <Icon name="Check" size={10} className="text-primary-foreground" />}
              </div>
              {m}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <StatCard label="Вероятность защиты" value={prob.toFixed(4)} color={meetsThreshold ? "green" : "orange"} />
          <StatCard label="Суммарная стоимость" value={cost} unit="ед." color="accent" />
          <StatCard label="Критерий δ (P/C)" value={delta.toFixed(5)} color="blue" />
          <div className={`panel p-3 flex items-center gap-2 ${meetsThreshold ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <Icon name={meetsThreshold ? "ShieldCheck" : "ShieldAlert"} size={16} className={meetsThreshold ? "text-emerald-400" : "text-amber-400"} />
            <div>
              <p className={`text-xs font-medium ${meetsThreshold ? "text-emerald-400" : "text-amber-400"}`}>
                {meetsThreshold ? "Порог достигнут" : "Порог не достигнут"}
              </p>
              <p className="text-xs text-muted-foreground">Требуется ≥ {data.threshold}</p>
            </div>
          </div>
        </div>

        <div className="panel p-4">
          <span className="label-xs block mb-3">Сравнение вариантов</span>
          <div className="space-y-3">
            {variants.map((v, vi) => {
              const vp = computeSystemProb(data, v.mech);
              const vc = computeSystemCost(data, v.mech);
              const isActive = JSON.stringify([...selected].sort()) === JSON.stringify([...v.mech].sort());
              return (
                <button
                  key={vi}
                  onClick={() => setSelected([...v.mech])}
                  className={`w-full text-left p-2.5 rounded border transition-all ${isActive ? "border-primary/40 bg-primary/5" : "border-border/50 hover:border-border"}`}
                >
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs font-medium">{v.label}</span>
                    <span className={`text-xs font-mono ${vp >= data.threshold ? "text-emerald-400" : "text-muted-foreground"}`}>{vp.toFixed(3)}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1">
                    <div className="bar-fill h-1 rounded-full bg-primary" style={{ width: `${vp * 100}%` }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{v.mech.length} мех.</span>
                    <span className="text-xs text-muted-foreground font-mono">{vc} ед.</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptimizationSection({ data }: { data: MatrixData }) {
  const [result, setResult] = useState<OptResult | null>(null);
  const [running, setRunning] = useState(false);
  const [threshold, setThreshold] = useState(data.threshold);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const modified = { ...data, threshold };
      setResult(optimize(modified));
      setRunning(false);
    }, 600);
  };

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Оптимизация</h2>
        <p className="text-sm text-muted-foreground">Поиск набора механизмов с минимальной стоимостью при заданном пороге вероятности</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-5 space-y-4">
          <span className="label-xs block">Параметры алгоритма</span>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Требуемый порог вероятности Ptr</label>
            <div className="flex items-center gap-3">
              <input
                type="range" min={0.5} max={0.99} step={0.01}
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="font-mono text-sm text-primary w-14 text-right">{threshold.toFixed(2)}</span>
            </div>
          </div>

          <div className="bg-muted/40 rounded p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Метод перебора</span>
              <span className="font-mono">Полный (2ⁿ)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Вариантов</span>
              <span className="font-mono">{(Math.pow(2, data.size) - 1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Критерий</span>
              <span className="font-mono">min(C) при P ≥ Ptr</span>
            </div>
          </div>

          <button
            onClick={run}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-60"
          >
            {running ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Вычисление...
              </>
            ) : (
              <>
                <Icon name="Cpu" size={15} />
                Запустить оптимизацию
              </>
            )}
          </button>
        </div>

        {result ? (
          <div className="panel p-5 space-y-4 glow-blue animate-fade-in">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="label-xs text-emerald-400">Оптимальное решение найдено</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="label-xs block mb-1">Вероятность</span>
                <span className="font-mono text-xl font-semibold text-emerald-400">{result.optProb.toFixed(4)}</span>
              </div>
              <div>
                <span className="label-xs block mb-1">Стоимость</span>
                <span className="font-mono text-xl font-semibold text-amber-400">{result.optCost} <span className="text-sm font-normal text-muted-foreground">ед.</span></span>
              </div>
              <div>
                <span className="label-xs block mb-1">Критерий δ</span>
                <span className="font-mono text-sm text-primary">{result.delta.toFixed(6)}</span>
              </div>
              <div>
                <span className="label-xs block mb-1">Механизмов</span>
                <span className="font-mono text-sm text-foreground">{result.optimalSet.length}</span>
              </div>
            </div>

            <div>
              <span className="label-xs block mb-2">Оптимальный набор X*</span>
              <div className="flex flex-wrap gap-2">
                {result.optimalSet.map(i => (
                  <span key={i} className="bg-primary/15 border border-primary/30 text-primary text-xs px-2.5 py-1 rounded font-medium">
                    {data.mechanisms[i]}
                  </span>
                ))}
              </div>
            </div>

            <div className="text-xs text-muted-foreground border-t border-border pt-3">
              Выполнено условие: P = {result.optProb.toFixed(4)} ≥ Ptr = {threshold.toFixed(2)}
            </div>
          </div>
        ) : (
          <div className="panel p-5 flex flex-col items-center justify-center text-center gap-3 min-h-[240px]">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Icon name="Cpu" size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Запустите алгоритм для поиска оптимального набора механизмов</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportSection({ data }: { data: MatrixData }) {
  const result = optimize(data);
  const rows: { sel: number[]; p: number; c: number; delta: number; meets: boolean }[] = [];
  for (let mask = 1; mask < Math.min(1 << data.size, 64); mask++) {
    const sel: number[] = [];
    for (let i = 0; i < data.size; i++) if (mask & (1 << i)) sel.push(i);
    const p = computeSystemProb(data, sel);
    const c = computeSystemCost(data, sel);
    rows.push({ sel, p, c, delta: p / (c || 1), meets: p >= data.threshold });
  }
  rows.sort((a, b) => b.p - a.p);

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">Отчет и экспорт</h2>
          <p className="text-sm text-muted-foreground">Сводные результаты по всем вариантам защиты</p>
        </div>
        <button className="flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-secondary/80 transition-colors border border-border">
          <Icon name="Download" size={14} />
          Экспорт CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Оптимальная P*" value={result.optProb.toFixed(4)} color="green" />
        <StatCard label="Мин. стоимость" value={result.optCost} unit="ед." color="orange" />
        <StatCard label="Механизмов в X*" value={result.optimalSet.length} color="blue" />
        <StatCard label="Всего вариантов" value={Math.pow(2, data.size) - 1} color="accent" />
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium">Все варианты ({rows.length})</span>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Порог достигнут</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />Не достигнут</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Набор механизмов</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Вероятность P</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Стоимость C</th>
                <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Критерий δ</th>
                <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((r, idx) => {
                const isOpt = JSON.stringify(r.sel) === JSON.stringify(result.optimalSet);
                return (
                  <tr key={idx} className={`border-b border-border/40 hover:bg-muted/30 transition-colors ${isOpt ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {r.sel.map(i => <span key={i} className="bg-muted px-1.5 py-0.5 rounded text-xs">{data.mechanisms[i].slice(0, 4)}</span>)}
                        {isOpt && <span className="text-primary text-xs font-medium ml-1">★ Опт.</span>}
                      </div>
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${r.meets ? "text-emerald-400" : "text-muted-foreground"}`}>{r.p.toFixed(4)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-amber-400">{r.c}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{r.delta.toFixed(5)}</td>
                    <td className="px-4 py-2 text-center">
                      {r.meets ? (
                        <span className="text-xs bg-emerald-400/10 text-emerald-400 px-2 py-0.5 rounded-full">✓</span>
                      ) : (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({ data, onUpdate }: { data: MatrixData; onUpdate: (d: MatrixData) => void }) {
  const [localThreshold, setLocalThreshold] = useState(data.threshold);

  const apply = () => onUpdate({ ...data, threshold: localThreshold });

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Настройки</h2>
        <p className="text-sm text-muted-foreground">Конфигурация алгоритмов и параметров системы</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-5 space-y-4">
          <span className="label-xs block">Параметры оптимизации</span>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Порог вероятности Ptr</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0.5} max={0.99} step={0.01}
                  value={localThreshold}
                  onChange={e => setLocalThreshold(parseFloat(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="font-mono text-sm text-primary w-14 text-right">{localThreshold.toFixed(2)}</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Метод оптимизации</label>
              <div className="space-y-2">
                {["Полный перебор (точный)", "Жадный алгоритм (быстрый)", "Генетический алгоритм"].map((m, i) => (
                  <label key={i} className="flex items-center gap-3 p-2.5 rounded border border-border/50 hover:border-border cursor-pointer">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${i === 0 ? "border-primary" : "border-border"}`}>
                      {i === 0 && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className="text-xs">{m}</span>
                    {i === 0 && <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Текущий</span>}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={apply}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Применить настройки
          </button>
        </div>

        <div className="panel p-5 space-y-4">
          <span className="label-xs block">Описание типа Matrix</span>
          <div className="bg-muted rounded p-4 font-mono text-xs space-y-1 text-muted-foreground leading-relaxed">
            {[
              { field: "SrUse", type: "Integer", desc: "Используемые средства" },
              { field: "p", type: "Single", desc: "Матрица вероятностей" },
              { field: "PPr", type: "Single", desc: "Промеж. значения P" },
              { field: "Cpr", type: "Single", desc: "Текущие стоимости" },
              { field: "C", type: "Integer", desc: "Общая матрица стоимостей" },
              { field: "x", type: "Integer", desc: "Текущий набор мех." },
              { field: "XOpt", type: "Integer", desc: "Оптимальный набор" },
              { field: "XPR", type: "Boolean", desc: "Флаги использования" },
              { field: "Delta", type: "Single", desc: "Значения критерия K" },
              { field: "COpt", type: "Single", desc: "Оптимальная стоимость" },
              { field: "POpt", type: "Single", desc: "Оптимальная P" },
              { field: "Ptr", type: "Single", desc: "Требуемая P" },
            ].map(({ field, type, desc }) => (
              <div key={field} className="flex gap-3">
                <span className="text-primary w-14 flex-shrink-0">{field}</span>
                <span className="text-amber-400 w-16 flex-shrink-0">{type}</span>
                <span className="text-muted-foreground">' {desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: "upload", label: "Загрузка данных", icon: "Upload" },
  { id: "matrix", label: "Визуализация матриц", icon: "Grid3x3" },
  { id: "analysis", label: "Анализ вариантов", icon: "BarChart3" },
  { id: "optimization", label: "Оптимизация", icon: "Cpu" },
  { id: "report", label: "Отчеты и экспорт", icon: "FileText" },
  { id: "settings", label: "Настройки", icon: "Settings2" },
];

export default function Index() {
  const [section, setSection] = useState<Section>("upload");
  const [data, setData] = useState<MatrixData>(DEMO);

  const renderSection = useCallback(() => {
    switch (section) {
      case "upload": return <UploadSection data={data} onLoad={setData} />;
      case "matrix": return <MatrixSection data={data} />;
      case "analysis": return <AnalysisSection data={data} />;
      case "optimization": return <OptimizationSection data={data} />;
      case "report": return <ReportSection data={data} />;
      case "settings": return <SettingsSection data={data} onUpdate={setData} />;
    }
  }, [section, data]);

  return (
    <div className="min-h-screen bg-background grid-bg flex flex-col">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center px-6 h-14 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-primary/20 border border-primary/30 flex items-center justify-center glow-blue">
              <Icon name="ShieldCheck" size={15} className="text-primary" />
            </div>
            <div>
              <span className="font-semibold text-sm tracking-tight">MatrixShield</span>
              <span className="text-muted-foreground text-xs ml-2">Анализ систем защиты</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-muted rounded px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-muted-foreground font-mono">{data.size} мех.</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono hidden sm:block">Ptr = {data.threshold}</div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-56 border-r border-border bg-sidebar/60 backdrop-blur-sm flex flex-col py-4 px-3 gap-1 shrink-0">
          <span className="label-xs px-3 mb-2">Навигация</span>
          {NAV.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`nav-item text-left ${section === id ? "active" : "text-muted-foreground"}`}
            >
              <Icon name={icon} size={15} />
              <span>{label}</span>
            </button>
          ))}

          <div className="mt-auto pt-4 border-t border-border px-3">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Порог P*</span>
                <span className="font-mono text-primary">{data.threshold}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Размер n</span>
                <span className="font-mono text-foreground">{data.size}</span>
              </div>
            </div>
          </div>
        </nav>

        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-5xl mx-auto">
            {renderSection()}
          </div>
        </main>
      </div>
    </div>
  );
}
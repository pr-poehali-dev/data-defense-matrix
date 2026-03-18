import { useState, useCallback } from "react";
import Icon from "@/components/ui/icon";

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = "upload" | "matrix" | "analysis" | "optimization" | "report" | "settings";

// 8 мероприятий (i=0..7), каждое имеет варианты j
// p[i][col][j]: col=0 основной вектор, col=1,2 доп. векторы для i=4,5
// C[i][j]: стоимость i-го мероприятия, j-го варианта
interface MatrixData {
  // p[i][col][j] — вероятности: 8 мероприятий, до 3 столбцов, варианты j
  p: number[][][];
  // C[i][j] — стоимости: 8 мероприятий, варианты j
  C: number[][];
  // число вариантов для каждого мероприятия
  varCount: number[];
  // названия мероприятий
  mechanisms: string[];
  // требуемый порог защищённости
  threshold: number;
}

interface SystemState {
  // текущий выбор: x[i] = индекс варианта для мероприятия i
  x: number[];
  // промежуточные вероятности PPr[i][col]
  PPr: number[][];
  // текущие стоимости Cpr[i]
  Cpr: number[];
}

interface OptResult {
  xOpt: number[];       // оптимальный набор вариантов
  optCost: number;
  optProb: number;
  deltaValues: number[];
  iterations: number;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────
// 8 мероприятий, 4 рубежа: [0,1] | [2,3] | [4,5] | [6,7]
// Каждое мероприятие имеет 3 варианта (j=0,1,2): дорогой→дешёвый

const DEMO: MatrixData = {
  mechanisms: [
    "Шифрование канала",    // Рубеж 1
    "Аутентификация",       // Рубеж 1
    "Брандмауэр",           // Рубеж 2
    "Фильтрация пакетов",   // Рубеж 2
    "IDS (основной)",       // Рубеж 3 (доп. векторы)
    "IPS (реакция)",        // Рубеж 3 (доп. векторы)
    "VPN-туннель",          // Рубеж 4
    "Контроль доступа",     // Рубеж 4
  ],
  varCount: [3, 3, 3, 3, 3, 3, 3, 3],
  threshold: 0.90,
  // p[i][col][j]: col=0 основной; col=1,2 только для i=4,5
  p: [
    // i=0 Шифрование
    [[0.97, 0.91, 0.82], [], []],
    // i=1 Аутентификация
    [[0.95, 0.88, 0.76], [], []],
    // i=2 Брандмауэр
    [[0.94, 0.86, 0.74], [], []],
    // i=3 Фильтрация
    [[0.92, 0.83, 0.71], [], []],
    // i=4 IDS — доп. векторы атак
    [[0.93, 0.85, 0.73], [0.90, 0.81, 0.68], [0.88, 0.78, 0.64]],
    // i=5 IPS — доп. векторы атак
    [[0.91, 0.82, 0.70], [0.89, 0.79, 0.66], [0.86, 0.76, 0.62]],
    // i=6 VPN
    [[0.96, 0.89, 0.79], [], []],
    // i=7 Контроль доступа
    [[0.94, 0.87, 0.77], [], []],
  ],
  // C[i][j]: стоимость в условных единицах
  C: [
    [180, 120, 70],
    [160, 110, 65],
    [140, 95,  55],
    [130, 88,  50],
    [170, 115, 68],
    [155, 105, 60],
    [175, 118, 72],
    [135, 92,  54],
  ],
};

// ─── Algorithms ───────────────────────────────────────────────────────────────

/**
 * PCount — восстановленный алгоритм расчёта вероятности защиты системы.
 * 4-рубежная эшелонированная защита:
 *   Рубеж 1: i=0,1 — параллельно (оба должны быть преодолены)
 *   Рубеж 2: i=2,3 — параллельно
 *   Рубеж 3: i=4,5 — с дополнительными векторами атак (col=0,1,2)
 *   Рубеж 4: i=6,7 — параллельно
 *
 * Q_рубеж = вероятность ПРЕОДОЛЕНИЯ рубежа нарушителем
 * P_защиты = 1 - Q_системы
 */
function pCount(data: MatrixData, x: number[]): { prob: number; cost: number; PPr: number[][]; Cpr: number[] } {
  // Заполняем PPr и Cpr из выбранных вариантов x[i]
  const PPr: number[][] = Array.from({ length: 8 }, () => [0, 0, 0]);
  const Cpr: number[] = new Array(8).fill(0);

  for (let i = 0; i < 8; i++) {
    const j = x[i];
    PPr[i][0] = data.p[i][0][j] ?? 0;
    Cpr[i] = data.C[i][j] ?? 0;
    if (i === 4 || i === 5) {
      PPr[i][1] = data.p[i][1][j] ?? 0;
      PPr[i][2] = data.p[i][2][j] ?? 0;
    }
  }

  // Вероятность ПРЕОДОЛЕНИЯ каждого рубежа нарушителем (оба механизма параллельны)
  // Q_рубеж = PPr(a,0) * PPr(b,0) — нарушитель должен преодолеть оба
  const Q1 = PPr[0][0] * PPr[1][0];

  const Q2 = PPr[2][0] * PPr[3][0];

  // Рубеж 3: 3 вектора атак, нарушитель выбирает лучший (наибольшую вероятность преодоления)
  // Вектор атаки 0: через IDS(col=0) и IPS(col=0)
  // Вектор атаки 1: через IDS(col=1) и IPS(col=1)
  // Вектор атаки 2: через IDS(col=2) и IPS(col=2)
  const Q3v0 = PPr[4][0] * PPr[5][0];
  const Q3v1 = PPr[4][1] * PPr[5][1];
  const Q3v2 = PPr[4][2] * PPr[5][2];
  // prom1 — формула из оригинала: последовательные попытки по векторам
  const prom1 = (1 - Q3v0) * (
    Q3v0 * (1 - Q3v1 - Q3v2 + Q3v1 * Q3v2) +
    (1 - Q3v0) * (
      Q3v1 * (1 - Q3v0 - Q3v2 + Q3v0 * Q3v2) +
      (1 - Q3v1) * Q3v2 * (1 - Q3v0 - Q3v1 + Q3v0 * Q3v1)
    )
  );
  const prom1adj = prom1 * ((1 - Q3v1) + Q3v1 * (1 - Q3v2));
  const prom2 = (1 - Q3v0) * (1 - Q3v1) * (1 - Q3v2) * (1 - Q3v0);
  const Q3 = 1 - prom1adj - prom2;

  const Q4 = PPr[6][0] * PPr[7][0];

  // Итоговая вероятность преодоления системы (последовательные рубежи — все нужно преодолеть)
  const Qsys = Q1 * Q2 * Q3 * Q4;
  const prob = 1 - Qsys;

  const cost = Cpr.reduce((s, c) => s + c, 0);

  return { prob, cost, PPr, Cpr };
}

/**
 * Итерационный алгоритм оптимизации по методике (аналог Command7_Click).
 * Старт: максимальная защита (j=0 для всех).
 * Итерация: заменяем механизм на следующий вариант (j+1) с min K=ΔC/ΔP,
 * пока P ≥ Ptr.
 */
function optimizeIterative(data: MatrixData): OptResult {
  const x = new Array(8).fill(0); // стартуем с лучших вариантов
  let { prob, cost } = pCount(data, x);

  // Если даже максимальная конфигурация не достигает порога
  if (prob < data.threshold) {
    return { xOpt: [...x], optCost: cost, optProb: prob, deltaValues: [], iterations: 0 };
  }

  let xOpt = [...x];
  let optCost = cost;
  let optProb = prob;
  let iterations = 0;
  const deltaValues: number[] = [];

  let improved = true;
  while (improved) {
    improved = false;
    let bestK = Infinity;
    let bestI = -1;

    for (let i = 0; i < 8; i++) {
      if (x[i] >= data.varCount[i] - 1) continue; // нет следующего варианта
      const xTry = [...x];
      xTry[i] = x[i] + 1;
      const res = pCount(data, xTry);
      if (res.prob < data.threshold) continue; // нарушаем условие

      const deltaP = prob - res.prob;   // ΔP (уменьшение защиты)
      const deltaC = cost - res.cost;   // ΔC (экономия стоимости)
      if (deltaC <= 0) continue;

      const K = deltaP / deltaC; // критерий K = ΔP/ΔC, ищем минимальный
      if (K < bestK) {
        bestK = K;
        bestI = i;
      }
    }

    if (bestI >= 0) {
      x[bestI] += 1;
      const res = pCount(data, x);
      prob = res.prob;
      cost = res.cost;
      deltaValues.push(bestK);
      iterations++;
      if (cost < optCost) {
        optCost = cost;
        optProb = prob;
        xOpt = [...x];
      }
      improved = true;
    }
  }

  return { xOpt, optCost, optProb, deltaValues, iterations };
}

// Вспомогательная: получить P и C для произвольного набора x[]
function getSystemStats(data: MatrixData, x: number[]) {
  return pCount(data, x);
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

const RUBEZHI = [
  { label: "Рубеж 1", mechs: [0, 1], color: "text-sky-400" },
  { label: "Рубеж 2", mechs: [2, 3], color: "text-violet-400" },
  { label: "Рубеж 3", mechs: [4, 5], color: "text-amber-400", note: "доп. векторы" },
  { label: "Рубеж 4", mechs: [6, 7], color: "text-emerald-400" },
];

function UploadSection({ data, onLoad }: { data: MatrixData; onLoad: (d: MatrixData) => void }) {
  const [dragging, setDragging] = useState(false);
  const startStats = getSystemStats(DEMO, new Array(8).fill(0));

  const handleDemoLoad = () => onLoad(DEMO);

  const handleJsonPaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const parsed = JSON.parse(e.target.value);
      if (parsed.p && parsed.C) onLoad(parsed as MatrixData);
    } catch (_e) { void _e; }
  };

  return (
    <div className="animate-slide-up space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Загрузка данных</h2>
        <p className="text-sm text-muted-foreground">Загрузите параметры БКС РТС или используйте демонстрационные данные</p>
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
            <p className="text-xs text-muted-foreground mt-1">Формат: {"{ p, C, varCount, mechanisms, threshold }"}</p>
          </div>
        </div>

        <div className="panel p-5 flex flex-col gap-3">
          <span className="label-xs">Вставить JSON напрямую</span>
          <textarea
            className="flex-1 bg-background border border-border rounded text-xs font-mono p-3 resize-none text-muted-foreground focus:outline-none focus:border-primary/50 min-h-[120px]"
            placeholder='{"p": [...], "C": [...], "varCount": [...], "threshold": 0.90}'
            onChange={handleJsonPaste}
          />
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Демонстрационный набор — БКС РТС ВН</h3>
            <p className="text-xs text-muted-foreground mt-0.5">8 мероприятий, 4-рубежная эшелонированная защита, 3 варианта на мероприятие</p>
          </div>
          <button
            onClick={handleDemoLoad}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Icon name="Play" size={14} />
            Загрузить демо
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">Мероприятий</span>
            <span className="font-mono font-semibold text-foreground">8</span>
          </div>
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">Рубежей защиты</span>
            <span className="font-mono font-semibold text-foreground">4</span>
          </div>
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">Порог Ptr</span>
            <span className="font-mono font-semibold text-foreground">0.90</span>
          </div>
          <div className="bg-muted rounded p-3">
            <span className="label-xs block mb-1">P макс. конф.</span>
            <span className="font-mono font-semibold text-emerald-400">{startStats.prob.toFixed(4)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {RUBEZHI.map((r) => (
            <div key={r.label} className="bg-background border border-border/50 rounded p-2.5">
              <span className={`text-xs font-semibold block mb-1 ${r.color}`}>{r.label}</span>
              {r.mechs.map(mi => (
                <p key={mi} className="text-xs text-muted-foreground">{DEMO.mechanisms[mi]}</p>
              ))}
              {r.note && <p className="text-xs text-amber-400/70 mt-1">{r.note}</p>}
            </div>
          ))}
        </div>
      </div>

      {data !== DEMO && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-2">
          <Icon name="CheckCircle" size={14} />
          Данные загружены: {data.mechanisms.length} мероприятий, порог Ptr = {data.threshold}
        </div>
      )}
    </div>
  );
}

function MatrixSection({ data }: { data: MatrixData }) {
  const [view, setView] = useState<"prob" | "cost">("prob");
  // Для таблицы: строки = мероприятия (i=0..7), столбцы = варианты (j=0..varCount-1)
  const maxP = Math.max(...data.p.map(row => row[0]).flat().filter(v => !isNaN(v)));
  const maxC = Math.max(...data.C.flat());

  const rubezColor = (i: number) => {
    if (i <= 1) return "text-sky-400";
    if (i <= 3) return "text-violet-400";
    if (i <= 5) return "text-amber-400";
    return "text-emerald-400";
  };
  const rubezLabel = (i: number) => ["Р1","Р1","Р2","Р2","Р3","Р3","Р4","Р4"][i];

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">Матрицы системы</h2>
          <p className="text-sm text-muted-foreground">P[i][j] — вероятности и C[i][j] — стоимости по вариантам j для каждого мероприятия i</p>
        </div>
        <div className="flex gap-1 bg-muted rounded p-1">
          <button onClick={() => setView("prob")} className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${view === "prob" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            Вероятности
          </button>
          <button onClick={() => setView("cost")} className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${view === "cost" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            Стоимости
          </button>
        </div>
      </div>

      <div className="panel p-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-xs text-muted-foreground font-medium w-8">Руб.</th>
              <th className="text-left px-2 py-1.5 text-xs text-muted-foreground font-medium min-w-[150px]">Мероприятие</th>
              {Array.from({ length: Math.max(...data.varCount) }, (_, j) => (
                <th key={j} className="text-center px-2 py-1.5 text-xs text-muted-foreground font-medium min-w-[72px]">Вар. {j + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.mechanisms.map((mech, i) => {
              const vals = view === "prob" ? data.p[i][0] : data.C[i];
              const maxVal = view === "prob" ? maxP : maxC;
              return (
                <tr key={i} className={i % 2 === 0 ? "bg-muted/10" : ""}>
                  <td className={`px-2 py-1.5 text-xs font-bold ${rubezColor(i)}`}>{rubezLabel(i)}</td>
                  <td className="px-2 py-1.5 text-xs font-medium text-foreground/80">{mech}</td>
                  {vals.map((val, j) => (
                    <HeatCell key={j} value={val} max={maxVal} type={view} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-16 h-3 rounded" style={{ background: "linear-gradient(to right, rgba(56,189,248,0.08), rgba(56,189,248,0.6))" }} />
          <span>{view === "prob" ? "Низкая → Высокая P" : "Низкая → Высокая C"}</span>
        </div>
        <span className="font-mono">{view === "prob" ? `Макс: ${maxP.toFixed(3)}` : `Макс: ${maxC}`}</span>
        <span className="text-muted-foreground/50">Р3 (i=4,5) имеет доп. векторы атак col=1,2</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {RUBEZHI.map((r) => {
          const ps = r.mechs.map(mi => data.p[mi][0][0]);
          const cs = r.mechs.map(mi => data.C[mi][0]);
          return (
            <div key={r.label} className="panel p-3">
              <span className={`label-xs block mb-2 ${r.color}`}>{r.label}</span>
              <div className="space-y-1">
                {r.mechs.map((mi) => (
                  <div key={mi} className="flex justify-between text-xs">
                    <span className="text-muted-foreground truncate mr-2">{data.mechanisms[mi].slice(0, 12)}</span>
                    <span className="font-mono text-primary flex-shrink-0">{data.p[mi][0][0].toFixed(2)}</span>
                  </div>
                ))}
                <div className="border-t border-border/40 pt-1 flex justify-between text-xs mt-1">
                  <span className="text-muted-foreground">Q руб.</span>
                  <span className="font-mono text-amber-400">{(ps.reduce((a,b)=>a*b,1)).toFixed(4)}</span>
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
  // x[i] — выбранный вариант j для мероприятия i
  const [x, setX] = useState<number[]>(new Array(8).fill(0));

  const setVariant = (i: number, j: number) => {
    setX(prev => { const next = [...prev]; next[i] = j; return next; });
  };

  const { prob, cost } = getSystemStats(data, x);
  const K = prob / (cost || 1);
  const meetsThreshold = prob >= data.threshold;

  // Предустановки для сравнения: лучший, средний, худший варианты
  const presets = [
    { label: "Макс. защита", x: new Array(8).fill(0) },
    { label: "Средний", x: new Array(8).fill(1) },
    { label: "Мин. стоимость", x: new Array(8).fill(2) },
  ];

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Анализ вариантов</h2>
        <p className="text-sm text-muted-foreground">Выберите вариант j для каждого мероприятия и увидьте P и C системы в реальном времени</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 panel p-4 space-y-2">
          <div className="flex items-center justify-between mb-3">
            <span className="label-xs">Текущий набор x[i]</span>
            <div className="flex gap-1">
              {presets.map((pr, pi) => (
                <button key={pi} onClick={() => setX([...pr.x])}
                  className="text-xs px-2 py-1 rounded bg-muted hover:bg-secondary text-muted-foreground hover:text-foreground transition-all">
                  {pr.label}
                </button>
              ))}
            </div>
          </div>
          {data.mechanisms.map((mech, i) => {
            const rColor = ["text-sky-400","text-sky-400","text-violet-400","text-violet-400","text-amber-400","text-amber-400","text-emerald-400","text-emerald-400"][i];
            const rLabel = ["Р1","Р1","Р2","Р2","Р3","Р3","Р4","Р4"][i];
            return (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                <span className={`text-xs font-bold w-6 flex-shrink-0 ${rColor}`}>{rLabel}</span>
                <span className="text-xs text-foreground/80 flex-1 min-w-0 truncate">{mech}</span>
                <div className="flex gap-1 flex-shrink-0">
                  {Array.from({ length: data.varCount[i] }, (_, j) => (
                    <button
                      key={j}
                      onClick={() => setVariant(i, j)}
                      className={`w-8 h-7 rounded text-xs font-mono transition-all ${x[i] === j ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                    >
                      {j + 1}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-mono text-primary w-12 text-right flex-shrink-0">{data.p[i][0][x[i]].toFixed(2)}</span>
                <span className="text-xs font-mono text-amber-400 w-12 text-right flex-shrink-0">{data.C[i][x[i]]}</span>
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          <StatCard label="Вероятность защиты Pз" value={prob.toFixed(4)} color={meetsThreshold ? "green" : "orange"} />
          <StatCard label="Суммарная стоимость Cз" value={cost} unit="ед." color="accent" />
          <StatCard label="Критерий K = P/C" value={K.toFixed(6)} color="blue" />
          <div className={`panel p-3 flex items-center gap-3 ${meetsThreshold ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <Icon name={meetsThreshold ? "ShieldCheck" : "ShieldAlert"} size={18} className={meetsThreshold ? "text-emerald-400" : "text-amber-400"} />
            <div>
              <p className={`text-xs font-semibold ${meetsThreshold ? "text-emerald-400" : "text-amber-400"}`}>
                {meetsThreshold ? "Условие Pз ≥ Ptr выполнено" : "Условие Pз ≥ Ptr нарушено"}
              </p>
              <p className="text-xs text-muted-foreground">Ptr = {data.threshold}</p>
            </div>
          </div>
          <div className="panel p-3 space-y-2">
            <span className="label-xs block mb-2">Вероятность по рубежам</span>
            {RUBEZHI.map((r) => {
              const Qr = r.mechs.reduce((acc, mi) => acc * data.p[mi][0][x[mi]], 1);
              return (
                <div key={r.label} className="flex items-center gap-2">
                  <span className={`text-xs font-medium w-14 flex-shrink-0 ${r.color}`}>{r.label}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5">
                    <div className="bar-fill h-1.5 rounded-full bg-primary" style={{ width: `${Qr * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-12 text-right">{Qr.toFixed(4)}</span>
                </div>
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
      setResult(optimizeIterative({ ...data, threshold }));
      setRunning(false);
    }, 700);
  };

  const totalVariants = data.varCount.reduce((a, b) => a * b, 1);

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h2 className="text-lg font-semibold mb-1">Оптимизация по методике</h2>
        <p className="text-sm text-muted-foreground">Итерационный поиск квазиоптимального X* — минимальная стоимость при Pз ≥ Ptr</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-5 space-y-4">
          <span className="label-xs block">Параметры алгоритма</span>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Требуемый порог вероятности Ptr</label>
            <div className="flex items-center gap-3">
              <input type="range" min={0.5} max={0.99} step={0.01}
                value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))}
                className="flex-1 accent-primary" />
              <span className="font-mono text-sm text-primary w-14 text-right">{threshold.toFixed(2)}</span>
            </div>
          </div>

          <div className="bg-muted/40 rounded p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Метод</span>
              <span className="font-mono">Итерационный (K=ΔP/ΔC)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Всего сочетаний</span>
              <span className="font-mono">{totalVariants}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Мероприятий</span>
              <span className="font-mono">8 (i=0..7)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Рубежей защиты</span>
              <span className="font-mono">4 (Р1..Р4)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Критерий K</span>
              <span className="font-mono">min(ΔP/ΔC)</span>
            </div>
          </div>

          <div className="bg-muted/20 rounded p-3 text-xs font-mono space-y-1 text-muted-foreground">
            <p className="text-foreground/70 font-sans text-xs mb-2">Логика PCount (4 рубежа):</p>
            <p>Q₁ = PPr[0][0] × PPr[1][0]</p>
            <p>Q₂ = PPr[2][0] × PPr[3][0]</p>
            <p>Q₃ = f(PPr[4,5][0..2])</p>
            <p>Q₄ = PPr[6][0] × PPr[7][0]</p>
            <p className="text-primary pt-1">Pз = 1 − Q₁·Q₂·Q₃·Q₄</p>
          </div>

          <button onClick={run} disabled={running}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-60">
            {running ? (
              <><div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Вычисление...</>
            ) : (
              <><Icon name="Cpu" size={15} />Запустить оптимизацию</>
            )}
          </button>
        </div>

        {result ? (
          <div className="panel p-5 space-y-4 glow-blue animate-fade-in">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${result.xOpt.length > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className={`label-xs ${result.xOpt.length > 0 ? "text-emerald-400" : "text-amber-400"}`}>
                {result.optProb >= threshold ? "Квазиоптимальное решение найдено" : "Ptr недостижим при данных параметрах"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="label-xs block mb-1">P* (Pз оптим.)</span>
                <span className="font-mono text-xl font-semibold text-emerald-400">{result.optProb.toFixed(4)}</span>
              </div>
              <div>
                <span className="label-xs block mb-1">C* (мин. стоим.)</span>
                <span className="font-mono text-xl font-semibold text-amber-400">{result.optCost} <span className="text-sm font-normal text-muted-foreground">ед.</span></span>
              </div>
              <div>
                <span className="label-xs block mb-1">Итераций</span>
                <span className="font-mono text-sm text-primary">{result.iterations}</span>
              </div>
              <div>
                <span className="label-xs block mb-1">Условие</span>
                <span className={`font-mono text-sm ${result.optProb >= threshold ? "text-emerald-400" : "text-amber-400"}`}>
                  {result.optProb >= threshold ? "✓ Выполнено" : "✗ Нарушено"}
                </span>
              </div>
            </div>

            <div>
              <span className="label-xs block mb-2">Оптимальный набор X* = [x₀..x₇]</span>
              <div className="grid grid-cols-4 gap-1.5">
                {result.xOpt.map((j, i) => (
                  <div key={i} className="bg-primary/10 border border-primary/20 rounded p-2 text-center">
                    <span className="text-xs text-muted-foreground block">i={i}</span>
                    <span className="font-mono font-semibold text-primary">j={j + 1}</span>
                    <span className="text-xs text-muted-foreground block truncate">{data.mechanisms[i].slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            </div>

            {result.deltaValues.length > 0 && (
              <div>
                <span className="label-xs block mb-2">История K = ΔP/ΔC по итерациям</span>
                <div className="flex gap-1 flex-wrap">
                  {result.deltaValues.map((k, idx) => (
                    <span key={idx} className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
                      {idx + 1}: {k.toFixed(5)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground border-t border-border pt-3">
              Pз = {result.optProb.toFixed(4)} ≥ Ptr = {threshold.toFixed(2)} | Cз = {result.optCost} ед.
            </div>
          </div>
        ) : (
          <div className="panel p-5 flex flex-col items-center justify-center text-center gap-3 min-h-[260px]">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Icon name="Cpu" size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Запустите итерационный алгоритм для поиска X*</p>
            <p className="text-xs text-muted-foreground/60">Старт: max P (j=0), итерации по min K</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportSection({ data }: { data: MatrixData }) {
  const optResult = optimizeIterative(data);

  // Генерируем таблицу всех комбинаций вариантов (ограничим до 3^8=6561, показываем топ-20)
  const rows: { x: number[]; p: number; c: number; K: number; meets: boolean }[] = [];
  // Перебираем ключевые наборы: все j одинаковые + оптимальный
  const keySets: number[][] = [
    new Array(8).fill(0),
    new Array(8).fill(1),
    new Array(8).fill(2),
    [...optResult.xOpt],
  ];
  // Добавим смешанные варианты
  for (let v = 0; v < 3; v++) {
    for (let i = 0; i < 8; i++) {
      const x = new Array(8).fill(0);
      x[i] = v;
      keySets.push(x);
    }
  }
  const seen = new Set<string>();
  for (const x of keySets) {
    const key = x.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const { prob, cost } = pCount(data, x);
    rows.push({ x, p: prob, c: cost, K: prob / (cost || 1), meets: prob >= data.threshold });
  }
  rows.sort((a, b) => b.p - a.p);

  const exportCSV = () => {
    const header = "x0,x1,x2,x3,x4,x5,x6,x7,P,C,K,Статус";
    const lines = rows.map(r =>
      `${r.x.join(",")},${r.p.toFixed(4)},${r.c},${r.K.toFixed(6)},${r.meets ? "OK" : "—"}`
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "matrixshield_report.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-1">Отчет и экспорт</h2>
          <p className="text-sm text-muted-foreground">Сводные результаты оптимизации и ключевые наборы вариантов</p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-secondary/80 transition-colors border border-border">
          <Icon name="Download" size={14} />
          Экспорт CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="P* оптимальная" value={optResult.optProb.toFixed(4)} color="green" />
        <StatCard label="C* минимальная" value={optResult.optCost} unit="ед." color="orange" />
        <StatCard label="Итераций алг." value={optResult.iterations} color="blue" />
        <StatCard label="Ptr порог" value={data.threshold} color="accent" />
      </div>

      <div className="panel p-4">
        <span className="label-xs block mb-3">Оптимальный набор X* = [x₀..x₇]</span>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {optResult.xOpt.map((j, i) => (
            <div key={i} className="bg-primary/10 border border-primary/20 rounded p-2 text-center">
              <span className="text-xs text-muted-foreground block">i={i}</span>
              <span className="font-mono font-bold text-primary text-base">j={j + 1}</span>
              <span className="text-xs text-muted-foreground block truncate mt-0.5">{data.mechanisms[i].slice(0, 7)}</span>
              <span className="text-xs font-mono text-emerald-400">{data.p[i][0][j].toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium">Ключевые наборы ({rows.length})</span>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Pз ≥ Ptr</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />Pз &lt; Ptr</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">X = [x₀..x₇]</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Pз</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">Cз</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground font-medium">K</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const isOpt = r.x.join(",") === optResult.xOpt.join(",");
                return (
                  <tr key={idx} className={`border-b border-border/40 hover:bg-muted/30 transition-colors ${isOpt ? "bg-primary/5" : ""}`}>
                    <td className="px-3 py-2 text-xs">
                      <span className="font-mono text-muted-foreground">[{r.x.map(j => j + 1).join(",")}]</span>
                      {isOpt && <span className="text-primary text-xs font-semibold ml-2">★ X*</span>}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-xs ${r.meets ? "text-emerald-400" : "text-muted-foreground"}`}>{r.p.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-amber-400">{r.c}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.K.toFixed(6)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.meets
                        ? <span className="text-xs bg-emerald-400/10 text-emerald-400 px-2 py-0.5 rounded-full">✓</span>
                        : <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">—</span>}
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
              <span className="text-xs text-muted-foreground font-mono">8 мер. / 4 руб.</span>
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
                <span className="text-muted-foreground">Ptr</span>
                <span className="font-mono text-primary">{data.threshold}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Мероприятий</span>
                <span className="font-mono text-foreground">8</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Рубежей</span>
                <span className="font-mono text-foreground">4</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Вариантов/мер.</span>
                <span className="font-mono text-foreground">{data.varCount[0]}</span>
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
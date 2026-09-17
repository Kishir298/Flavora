/** Dependency-free accessible SVG charts. Every chart ships with a text summary. */

export function BarChart({ values, labels, title, barLabel }: {
  values: number[]; labels: string[]; title: string; barLabel: (v: number, i: number) => string;
}) {
  const max = Math.max(1, ...values);
  const W = 320, H = 140, pad = 24;
  const bw = (W - pad * 2) / Math.max(1, values.length);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="w-full">
        {values.map((v, i) => {
          const h = ((H - pad * 2) * v) / max;
          return (
            <g key={i}>
              <rect
                x={pad + i * bw + 2} y={H - pad - h} width={Math.max(1, bw - 4)} height={Math.max(1, h)}
                fill="#15803d" rx="2"
              >
                <title>{barLabel(v, i)}</title>
              </rect>
              <text x={pad + i * bw + bw / 2} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor">
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{title}. {values.map((v, i) => `${labels[i]} ${v}`).join(", ")}</figcaption>
    </figure>
  );
}

export function GoalRing({ actual, target, label }: { actual: number; target: number; label: string }) {
  const pct = target > 0 ? Math.min(1, actual / target) : 0;
  const R = 26, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`${label}: ${actual} of ${target}`}>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="8" className="stroke-neutral-200 dark:stroke-neutral-700" />
        <circle
          cx="32" cy="32" r={R} fill="none" strokeWidth="8" stroke="#15803d"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)} strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" fontSize="12" textAnchor="middle" fill="currentColor">{Math.round(pct * 100)}%</text>
      </svg>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-sm opacity-70">{actual} of {target}</div>
      </div>
    </div>
  );
}

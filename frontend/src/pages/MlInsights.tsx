import { BrainCircuit, Database, FlaskConical, Gauge, Sigma } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, CardTitle, cx, PageHeader, Pill, Stat, toneText } from '../components/ui/primitives'
import { formatDateTime } from '../lib/format'
import { ML_CLASS_LABEL, ML_CLASS_TONE, ML_FEATURE_LABEL } from '../lib/ml'
import { fresh } from '../lib/status'
import { api } from '../services/api'
import { useTelemetry } from '../state/TelemetryProvider'
import type { MlClass, MlModelInfo } from '../types/telemetry'

const BAR: Record<MlClass, string> = { safe: 'bg-ok', caution: 'bg-warn', danger: 'bg-bad', accident: 'bg-bad' }
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

function Bar({ value, className }: { value: number; className: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-inset">
      <div className={cx('h-full rounded-full transition-[width] duration-500', className)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

function LivePrediction() {
  const { snapshot, connection } = useTelemetry()
  const ml = snapshot?.derived.ml
  const live = fresh(connection.state)

  if (!ml?.available || !ml.label) {
    return (
      <Card className="p-5">
        <CardTitle icon={<Gauge size={24} />}>Live prediction</CardTitle>
        <p className="mt-4 text-sm text-muted">No prediction right now{ml?.reason ? `: ${ml.reason}` : ''}.</p>
      </Card>
    )
  }
  const tone = live ? ML_CLASS_TONE[ml.label] : 'neutral'
  return (
    <Card className="p-5">
      <CardTitle icon={<Gauge size={24} />} right={<Pill tone="accent" className="!py-0.5 !text-xs">XGBoost</Pill>}>Live prediction</CardTitle>
      <div className="mt-4 flex items-baseline gap-3">
        <span className={cx('text-[34px] font-bold leading-none tracking-tight', toneText[tone])}>{ML_CLASS_LABEL[ml.label]}</span>
        <span className="text-[15px] text-muted tabular-nums">{pct(ml.confidence ?? 0)} confidence</span>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {(Object.keys(ML_CLASS_LABEL) as MlClass[]).map((c) => (
          <div key={c} className="grid grid-cols-[84px_1fr_56px] items-center gap-3 text-sm">
            <span className="text-fg">{ML_CLASS_LABEL[c]}</span>
            <Bar value={ml.probabilities[c] ?? 0} className={BAR[c]} />
            <span className="text-right tabular-nums text-muted">{pct(ml.probabilities[c] ?? 0)}</span>
          </div>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold text-fg">Model inputs right now</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {Object.entries(ml.features).map(([k, v]) => {
          const f = ML_FEATURE_LABEL[k] ?? { label: k, unit: '' }
          const shown = v === null ? '—' : k === 'ir_any' ? (v ? 'Detected' : 'Clear') : `${Math.round(v * 10) / 10}${f.unit ? ` ${f.unit}` : ''}`
          return (
            <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
              <dt className="text-muted">{f.label}</dt><dd className="tabular-nums text-fg">{shown}</dd>
            </div>
          )
        })}
      </dl>
    </Card>
  )
}

export default function MlInsights() {
  const [info, setInfo] = useState<MlModelInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.mlModel().then(setInfo).catch((e) => setError(e.message))
  }, [])
  const meta = info?.meta
  const importance = meta ? Object.entries(meta.feature_importance).sort((a, b) => b[1] - a[1]) : []
  const maxImp = importance[0]?.[1] || 1

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader icon={<BrainCircuit size={36} />} title="ML Insights" subtitle="XGBoost accident-risk model: live prediction, accuracy and training data" />
      {error && <div className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-2.5 text-sm text-bad">{error}</div>}
      {info && !info.available && <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-sm text-warn">Model unavailable: {info.reason}</div>}

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <LivePrediction />
        <Card className="p-5">
          <CardTitle icon={<Sigma size={24} />}>Model</CardTitle>
          {meta && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Test accuracy" value={pct(meta.metrics.accuracy)} tone="ok" />
                <Stat label="Macro F1" value={meta.metrics.macro_f1.toFixed(3)} />
                <Stat label="Training rows" value={meta.data.train_rows.toLocaleString()} />
                <Stat label="Trees used" value={meta.best_iteration + 1} />
              </div>
              <dl className="mt-5 grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
                <dt className="text-dim">Algorithm</dt><dd className="text-fg">{meta.algorithm}</dd>
                <dt className="text-dim">Classes</dt><dd className="text-fg">{meta.classes.map((c) => ML_CLASS_LABEL[c]).join(' · ')}</dd>
                <dt className="text-dim">Trained</dt><dd className="text-fg">{formatDateTime(meta.trained_at)} · xgboost {meta.xgboost_version}</dd>
                <dt className="text-dim">Split</dt><dd className="text-fg">{meta.data.train_rows} train · {meta.data.validation_rows} validation (early stopping) · {meta.data.test_rows} test</dd>
                <dt className="text-dim">Hyperparameters</dt><dd className="font-mono text-xs text-fg">max_depth {meta.params.max_depth} · learning_rate {meta.params.learning_rate} · subsample {meta.params.subsample}</dd>
              </dl>
              <h3 className="mt-6 text-sm font-semibold text-fg">Feature importance (gain)</h3>
              <div className="mt-3 flex flex-col gap-2.5">
                {importance.map(([f, v]) => (
                  <div key={f} className="grid grid-cols-[150px_1fr_52px] items-center gap-3 text-sm">
                    <span className="truncate text-fg">{ML_FEATURE_LABEL[f]?.label ?? f}</span>
                    <Bar value={v / maxImp} className="bg-accent" />
                    <span className="text-right tabular-nums text-muted">{pct(v, 0)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {meta && (
        <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
          <Card className="overflow-x-auto p-5">
            <CardTitle icon={<FlaskConical size={24} />}>Confusion matrix</CardTitle>
            <p className="mt-1 text-xs text-dim">Rows = true class, columns = predicted · {meta.metrics.evaluated_on}</p>
            <table className="mt-4 w-full text-sm tabular-nums">
              <thead>
                <tr className="text-muted">
                  <th className="p-2 text-left font-medium" />
                  {meta.classes.map((c) => <th key={c} className="p-2 text-right font-medium">{ML_CLASS_LABEL[c]}</th>)}
                  <th className="p-2 text-right font-medium">Recall</th>
                </tr>
              </thead>
              <tbody>
                {meta.metrics.confusion_matrix.map((row, i) => (
                  <tr key={i} className="border-t border-line">
                    <th className="p-2 text-left font-medium text-fg">{ML_CLASS_LABEL[meta.classes[i]]}</th>
                    {row.map((v, j) => (
                      <td key={j} className={cx('p-2 text-right', i === j ? 'font-bold text-ok' : v ? 'text-warn' : 'text-dim')}>{v}</td>
                    ))}
                    <td className="p-2 text-right text-fg">{pct(meta.metrics.per_class[meta.classes[i]].recall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto p-5">
            <CardTitle icon={<Database size={24} />}>How the training data is synthesized</CardTitle>
            <p className="mt-2 text-sm text-muted">
              Crash data can't be collected without crashing the car, so <b className="text-fg">{meta.data.rows.toLocaleString()}</b> labelled rows are generated from driving scenarios.
              Each scenario sets what the sensors would physically report; every row then gets measurement noise,
              random sensor dropouts ({Object.entries(meta.data.dropout).map(([k, v]) => `${ML_FEATURE_LABEL[k]?.label ?? k} ${pct(v, 0)}`).join(', ')})
              and {pct(meta.data.label_noise, 0)} flipped labels, so the model has to cope with imperfect data.
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="p-2 font-medium">Scenario</th><th className="p-2 font-medium">Label</th>
                  <th className="p-2 text-right font-medium">Share</th><th className="p-2 font-medium">What the sensors see</th>
                </tr>
              </thead>
              <tbody>
                {meta.data.scenarios.map((s) => (
                  <tr key={s.name} className="border-t border-line align-top">
                    <td className="p-2 font-mono text-xs text-fg">{s.name}</td>
                    <td className="p-2"><Pill tone={ML_CLASS_TONE[s.label]} className="!px-2 !py-0.5 !text-[11px] uppercase">{s.label}</Pill></td>
                    <td className="p-2 text-right tabular-nums text-fg">{pct(s.share, 0)}</td>
                    <td className="p-2 text-muted">{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-dim">Regenerate and retrain: <code className="font-mono">python ml/synthesize.py</code> then <code className="font-mono">python ml/train.py</code> · data in {meta.data.file}</p>
          </Card>
        </div>
      )}
    </div>
  )
}

import { KeyRound, Monitor, Moon, Save, Settings as SettingsIcon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Card, cx, PageHeader, Pill } from '../components/ui/primitives'
import { api, ApiError, getOperatorKey, setOperatorKey } from '../services/api'
import { useTelemetry } from '../state/TelemetryProvider'
import { useTheme, type ThemePreference } from '../theme/ThemeProvider'
import type { Mode, Thresholds } from '../types/telemetry'

const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; unit: string }[] = [
  { key: 'obstacle_warning_cm', label: 'Obstacle warning distance', unit: 'cm' },
  { key: 'obstacle_critical_cm', label: 'Obstacle critical distance', unit: 'cm' },
  { key: 'battery_warning_pct', label: 'Battery charge warning', unit: '%' },
  { key: 'battery_critical_pct', label: 'Battery charge critical', unit: '%' },
  { key: 'battery_min_voltage', label: 'Battery low voltage', unit: 'V' },
  { key: 'soh_warning_pct', label: 'Battery health warning', unit: '%' },
  { key: 'abnormal_accel_ms2', label: 'Abnormal acceleration (beyond gravity)', unit: 'm/s²' },
  { key: 'abnormal_gyro_dps', label: 'Abnormal angular rate', unit: '°/s' },
]

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

export default function Settings() {
  const { preference, setPreference } = useTheme()
  const { config, refreshConfig } = useTelemetry()
  const [key, setKey] = useState(getOperatorKey())
  const [keySaved, setKeySaved] = useState(false)
  const [draft, setDraft] = useState<Thresholds | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [pendingMode, setPendingMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (config && !draft) setDraft(config.thresholds)
  }, [config, draft])

  const saveThresholds = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const cfg = await api.setThresholds(draft)
      setDraft(cfg.thresholds)
      await refreshConfig()
      setMsg({ tone: 'ok', text: 'Thresholds saved (in server memory until restart; set THRESHOLD_* in .env to persist).' })
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally {
      setBusy(false)
    }
  }

  const switchMode = async () => {
    if (!pendingMode) return
    setBusy(true)
    try {
      await api.setMode(pendingMode)
      await refreshConfig()
      setMsg({ tone: 'ok', text: `Switched to ${pendingMode} mode. Buffered data from the previous mode was discarded.` })
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof ApiError ? e.message : 'Mode switch failed' })
    } finally {
      setBusy(false)
      setPendingMode(null)
    }
  }

  const themes: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'system', label: 'System', icon: <Monitor size={16} /> },
    { value: 'light', label: 'Light', icon: <Sun size={16} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  ]

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader icon={<SettingsIcon size={36} />} title="Settings" subtitle="Appearance, thresholds, data source and datastream mapping" />
      {msg && (
        <div className={cx('rounded-lg border px-4 py-2.5 text-sm', msg.tone === 'ok' ? 'border-ok/30 bg-ok-soft text-ok' : 'border-bad/30 bg-bad-soft text-bad')}>{msg.text}</div>
      )}
      {config?.config_errors.map((e) => (
        <div key={e} className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-sm text-warn">{e}</div>
      ))}
      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Appearance">
          <div className="inline-flex gap-1 rounded-lg border border-line-strong bg-inset p-1" role="radiogroup" aria-label="Theme">
            {themes.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={preference === t.value}
                onClick={() => setPreference(t.value)}
                className={cx('flex items-center gap-2 rounded-md px-4 py-2 text-sm', preference === t.value ? 'bg-card font-semibold text-fg shadow-card' : 'text-muted hover:text-fg')}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-dim">Saved in this browser. “System” follows your operating-system setting.</p>
        </Section>

        <Section title="Operator access" right={<KeyRound size={18} className="text-muted" />}>
          <p className="text-sm text-muted">
            Commands, threshold edits and mode switches require the server's <code className="rounded bg-inset px-1">LIGHTSYNC_API_KEY</code>
            {config?.operator_auth_required ? '.' : ' — not required right now because the server is in demo mode with no key set.'}
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setOperatorKey(key.trim())
              setKeySaved(true)
            }}
          >
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => { setKey(e.target.value); setKeySaved(false) }}
              placeholder="Operator key"
              aria-label="Operator key"
              className="h-10 flex-1 rounded-lg border border-line-strong bg-inset px-3 text-sm text-fg"
            />
            <button type="submit" className="rounded-lg bg-accent px-4 text-sm font-semibold text-[#04202a]">Use key</button>
          </form>
          <p className="mt-2 text-xs text-dim">{keySaved ? 'Stored for this browser session only.' : 'Kept in session storage; cleared when the tab closes. This is not the Blynk token.'}</p>
        </Section>

        <Section title="Data source" right={config && <Pill tone={config.mode === 'demo' ? 'demo' : 'ok'} className="!text-xs uppercase">{config.mode}</Pill>}>
          <dl className="grid grid-cols-[190px_1fr] gap-y-2 text-sm">
            <dt className="text-dim">Blynk token on server</dt><dd className="text-fg">{config?.blynk_configured ? 'Configured' : 'Not configured'}</dd>
            <dt className="text-dim">Blynk server</dt><dd className="text-fg">{config?.blynk_server}</dd>
            <dt className="text-dim">Poll interval</dt><dd className="text-fg">{config?.poll_interval} s</dd>
            <dt className="text-dim">Freshness threshold</dt><dd className="text-fg">{config?.freshness_seconds} s <span className="text-dim">(TELEMETRY_FRESHNESS_SECONDS)</span></dd>
            <dt className="text-dim">History buffer</dt><dd className="text-fg">{config?.history_max_samples} samples</dd>
            <dt className="text-dim">Remote commands</dt><dd className="text-fg">{config?.commands_enabled ? 'Enabled' : 'Disabled (COMMANDS_ENABLED=false)'}</dd>
          </dl>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={config?.mode === 'live' || busy} onClick={() => setPendingMode('live')} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-fg hover:bg-inset disabled:opacity-40">Switch to live</button>
            <button type="button" disabled={config?.mode === 'demo' || busy} onClick={() => setPendingMode('demo')} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-fg hover:bg-inset disabled:opacity-40">Switch to demo</button>
          </div>
          <p className="mt-2 text-xs text-dim">Switching discards buffered samples and events so demo and live data never mix. Set LIGHTSYNC_MODE in .env for the startup mode.</p>
        </Section>

        <Section title="Display thresholds" right={
          <button type="button" onClick={saveThresholds} disabled={busy || !draft} className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-[#04202a] disabled:opacity-50"><Save size={15} /> Save</button>
        }>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              {THRESHOLD_FIELDS.map((f) => (
                <label key={f.key} className="text-sm">
                  <span className="text-muted">{f.label}</span>
                  <span className="mt-1 flex items-center rounded-lg border border-line-strong bg-inset pr-3">
                    <input
                      type="number"
                      step="any"
                      value={draft[f.key]}
                      onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
                      className="h-9 w-full bg-transparent px-3 text-fg outline-none"
                    />
                    <span className="text-xs text-dim">{f.unit}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Datastream mapping">
        <p className="mb-3 text-sm text-muted">
          Read-only view of the server's pin configuration. Change a pin with <code className="rounded bg-inset px-1">PIN_&lt;FIELD&gt;=V12</code> (or <code className="rounded bg-inset px-1">none</code>) in <code className="rounded bg-inset px-1">.env</code> and restart the backend.
          Default pins are suggestions and must match your Blynk template.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-dim">
              <tr><th className="py-2">Field</th><th className="py-2">Env variable</th><th className="py-2">Pin</th><th className="py-2">Default</th><th className="py-2">Unit</th><th className="py-2">Description</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {config?.datastreams.map((d) => (
                <tr key={d.key}>
                  <td className="py-2 text-fg">{d.label}</td>
                  <td className="py-2 font-mono text-xs text-muted">PIN_{d.key.toUpperCase()}</td>
                  <td className="py-2">{d.mapped ? <Pill tone="ok" className="!py-0.5 !text-xs">{d.pin?.toUpperCase()}</Pill> : <Pill tone="neutral" className="!py-0.5 !text-xs">unmapped</Pill>}</td>
                  <td className="py-2 text-muted">{d.default_pin ?? '—'}</td>
                  <td className="py-2 text-muted">{d.unit ?? '—'}</td>
                  <td className="py-2 text-xs text-dim">{d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <ConfirmDialog
        open={!!pendingMode}
        title={`Switch to ${pendingMode} mode?`}
        confirmLabel="Switch"
        busy={busy}
        onConfirm={switchMode}
        onCancel={() => setPendingMode(null)}
      >
        {pendingMode === 'live'
          ? 'The backend will poll Blynk for real hardware telemetry. If no token is configured the dashboard shows OFFLINE — it never falls back to demo data.'
          : 'The backend will stop polling Blynk and serve simulated demo data, clearly labelled as such.'}
      </ConfirmDialog>
    </div>
  )
}

import { useState } from 'react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { api, ApiError } from '../services/api'
import { useTelemetry } from '../state/TelemetryProvider'
import type { CommandAvailability, CommandResult } from '../types/telemetry'

type CommandKey = CommandAvailability['key']

interface Pending {
  key: CommandKey
  value: boolean
}

const COPY: Record<CommandKey, (value: boolean, demo: boolean) => { title: string; body: string; confirm: string; danger: boolean }> = {
  cmd_autonomous_mode: (v, demo) => ({
    title: v ? 'Enable autonomous mode?' : 'Disable autonomous mode?',
    body: demo
      ? 'Demo mode: this only changes the simulator.'
      : `This sends a request to the vehicle to ${v ? 'enable' : 'disable'} autonomous mode. The dashboard waits for the hardware to confirm the new state.`,
    confirm: v ? 'Enable' : 'Disable',
    danger: v,
  }),
  cmd_emergency_stop: (v, demo) => ({
    title: v ? 'Request emergency stop?' : 'Release emergency stop?',
    body: demo
      ? 'Demo mode: this only changes the simulator.'
      : v
        ? 'This sends an emergency-stop request through Blynk. It is not a substitute for the physical emergency-stop circuit, which must stop the vehicle independently of this dashboard.'
        : 'Only release the stop after confirming on site that it is safe. The hardware must confirm the release.',
    confirm: v ? 'Send stop request' : 'Release',
    danger: true,
  }),
}

export function useCommand() {
  const { config, snapshot } = useTelemetry()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommandResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const availability = (key: CommandKey) => config?.commands.find((c) => c.key === key)

  const ask = (key: CommandKey, value: boolean) => {
    setError(null)
    setPending({ key, value })
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      const fn = pending.key === 'cmd_autonomous_mode' ? api.setAutonomous : api.setEmergencyStop
      const res = await fn(pending.value)
      setResult(res)
      if (res.status !== 'acknowledged') setError(res.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Command failed')
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const demo = (snapshot?.mode ?? config?.mode) === 'demo'
  const copy = pending ? COPY[pending.key](pending.value, demo) : null
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={copy?.title ?? ''}
      confirmLabel={copy?.confirm ?? 'Confirm'}
      danger={copy?.danger}
      busy={busy}
      onConfirm={confirm}
      onCancel={() => setPending(null)}
    >
      {copy?.body}
    </ConfirmDialog>
  )

  return { ask, dialog, busy, result, error, availability, clearError: () => setError(null) }
}

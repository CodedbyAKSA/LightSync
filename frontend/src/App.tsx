import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import Overview from './pages/Overview'
import { TelemetryProvider } from './state/TelemetryProvider'
import { ThemeProvider } from './theme/ThemeProvider'

const LiveSensors = lazy(() => import('./pages/LiveSensors'))
const SafetyEvents = lazy(() => import('./pages/SafetyEvents'))
const BatteryHealth = lazy(() => import('./pages/BatteryHealth'))
const Automation = lazy(() => import('./pages/Automation'))
const DeviceNetwork = lazy(() => import('./pages/DeviceNetwork'))
const Settings = lazy(() => import('./pages/Settings'))

function Loading() {
  return <div className="p-6 text-sm text-dim">Loading…</div>
}

export default function App() {
  return (
    <ThemeProvider>
      <TelemetryProvider>
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Overview />} />
                <Route path="sensors" element={<LiveSensors />} />
                <Route path="events" element={<SafetyEvents />} />
                <Route path="battery" element={<BatteryHealth />} />
                <Route path="automation" element={<Automation />} />
                <Route path="network" element={<DeviceNetwork />} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TelemetryProvider>
    </ThemeProvider>
  )
}

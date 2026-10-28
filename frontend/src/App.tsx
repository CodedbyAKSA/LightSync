import { lazy } from 'react'
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

export default function App() {
  return (
    <ThemeProvider>
      <TelemetryProvider>
        <BrowserRouter>
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
        </BrowserRouter>
      </TelemetryProvider>
    </ThemeProvider>
  )
}

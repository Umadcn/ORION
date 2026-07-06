import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SatellitesPage from './pages/SatellitesPage';
import SatelliteDetailsPage from './pages/SatelliteDetailsPage';
import TelemetryPage from './pages/TelemetryPage';
import AlertsPage from './pages/AlertsPage';
import InvestigationsPage from './pages/InvestigationsPage';
import InvestigationDetailsPage from './pages/InvestigationDetailsPage';
import AiInsightsPage from './pages/AiInsightsPage';
import AiEvaluationPage from './pages/AiEvaluationPage';
import AiAssistantPage from './pages/AiAssistantPage';
import OrbitPage from './pages/OrbitPage';
import SimulationPage from './pages/SimulationPage';
import ReportsPage from './pages/ReportsPage';
import ReportDetailsPage from './pages/ReportDetailsPage';
import SettingsPage from './pages/SettingsPage';

/** Authenticated application (shell + protected routes). */
function AppRoutes() {
  return (
    <ProtectedRoute>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/satellites" element={<SatellitesPage />} />
          <Route path="/satellites/:id" element={<SatelliteDetailsPage />} />
          <Route path="/telemetry" element={<TelemetryPage />} />
          <Route path="/orbit" element={<OrbitPage />} />
          <Route path="/ai-insights" element={<AiInsightsPage />} />
          <Route path="/ai-evaluation" element={<AiEvaluationPage />} />
          <Route path="/ai-assistant" element={<AiAssistantPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/investigations" element={<InvestigationsPage />} />
          <Route path="/investigations/:id" element={<InvestigationDetailsPage />} />
          <Route path="/simulation" element={<SimulationPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:id" element={<ReportDetailsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<AppRoutes />} />
      </Routes>
    </AuthProvider>
  );
}

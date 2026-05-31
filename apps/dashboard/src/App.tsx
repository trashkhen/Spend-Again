import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Login } from './pages/Login'
import { Auth } from './pages/Auth'
import { Welcome } from './pages/Welcome'
import { Dashboard } from './pages/Dashboard'
import { Analytics } from './pages/Analytics'
import { Recurring } from './pages/Recurring'
import { Spaces, SpaceDetail } from './pages/Spaces'
import { People, PersonDetail } from './pages/People'
import { ProtectedRoute } from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/welcome" element={<Welcome />} />

        {/* Protected routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <Analytics />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recurring"
          element={
            <ProtectedRoute>
              <Recurring />
            </ProtectedRoute>
          }
        />
        <Route
          path="/spaces"
          element={
            <ProtectedRoute>
              <Spaces />
            </ProtectedRoute>
          }
        />
        <Route
          path="/spaces/:id"
          element={
            <ProtectedRoute>
              <SpaceDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/people"
          element={
            <ProtectedRoute>
              <People />
            </ProtectedRoute>
          }
        />
        <Route
          path="/people/:id"
          element={
            <ProtectedRoute>
              <PersonDetail />
            </ProtectedRoute>
          }
        />
        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { TrackerProvider } from './lib/data'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import AddData from './pages/AddData'
import Report from './pages/Report'
import Login from './pages/Login'

function Gate() {
  const { ready, signedIn } = useAuth()
  if (!ready) return null
  if (!signedIn) return <Login />
  return (
    <TrackerProvider>
      <BrowserRouter>
        <Routes>
          <Route path="projects/:id/report" element={<Report />} />
          <Route element={<Layout />}>
            <Route index element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="add" element={<AddData />} />
            <Route path="*" element={<Projects />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TrackerProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

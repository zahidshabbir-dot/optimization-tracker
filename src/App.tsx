import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { TrackerProvider } from './lib/data'
import Layout from './components/Layout'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import AddData from './pages/AddData'

export default function App() {
  return (
    <TrackerProvider>
      <BrowserRouter>
        <Routes>
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

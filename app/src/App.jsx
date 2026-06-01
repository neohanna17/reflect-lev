import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Spinner from './components/Spinner';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import Modules from './pages/Modules';
import ModuleTests from './pages/ModuleTests';
import TestDetail from './pages/TestDetail';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Suites from './pages/Suites';
import Components from './pages/Components';
import Reports from './pages/Reports';
import Guide from './pages/Guide';
import TechGuide from './pages/TechGuide';
import Feedback from './pages/Feedback';

export default function App() {
  const { user, member, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!user) return <Login />;
  if (!member) return <NoAccess />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Modules />} />
        <Route path="/modules/:name" element={<ModuleTests />} />
        <Route path="/tests/:id" element={<TestDetail />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="/suites" element={<Suites />} />
        <Route path="/components" element={<Components />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/tech" element={<TechGuide />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

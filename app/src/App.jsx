import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Spinner from './components/Spinner';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import TestsList from './pages/TestsList';
import TestDetail from './pages/TestDetail';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Suites from './pages/Suites';

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
        <Route path="/" element={<TestsList />} />
        <Route path="/tests/:id" element={<TestDetail />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="/suites" element={<Suites />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

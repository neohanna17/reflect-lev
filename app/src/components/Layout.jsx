import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Modules', end: true },
  { to: '/runs', label: 'Runs' },
  { to: '/suites', label: 'Suites' },
  { to: '/components', label: 'Components' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [logoOk, setLogoOk] = useState(true);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-ink-600 bg-white">
        <button
          onClick={() => navigate('/')}
          className="flex flex-col items-start gap-1 px-4 py-4 border-b border-ink-600"
        >
          {logoOk ? (
            <img
              src="/logo.png"
              alt="levcharity"
              className="h-7 w-auto max-w-full"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <span className="text-xl font-bold tracking-tight text-gray-900">levcharity</span>
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">
            QA Dashboard
          </span>
        </button>

        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : 'text-gray-500 hover:bg-ink-700 hover:text-gray-800'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-ink-600 p-3">
          {user && (
            <div className="flex items-center gap-2">
              {user.photoURL && (
                <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full" />
              )}
              <span className="flex-1 truncate text-xs text-gray-500">
                {user.displayName || user.email}
              </span>
              <button onClick={logout} className="btn-ghost py-1 px-2 text-xs">
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}

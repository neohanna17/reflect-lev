import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Tests', end: true },
  { to: '/runs', label: 'Runs' },
  { to: '/suites', label: 'Suites' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-ink-600 bg-ink-800/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand text-white text-sm font-bold">
              R
            </span>
            Reflect-LEV
          </button>
          <nav className="flex items-center gap-1">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-ink-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <>
                <span className="hidden sm:flex items-center gap-2 text-sm text-gray-400">
                  {user.photoURL && (
                    <img src={user.photoURL} alt="" className="h-6 w-6 rounded-full" />
                  )}
                  {user.displayName || user.email}
                </span>
                <button onClick={logout} className="btn-ghost py-1.5 px-2.5 text-xs">
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [error, setError] = useState('');

  async function handleLogin() {
    setError('');
    try {
      await login();
    } catch (e) {
      setError(e.message || 'Sign-in failed');
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand text-xl font-bold text-white">
          R
        </div>
        <h1 className="mt-4 text-xl font-semibold">Reflect-LEV</h1>
        <p className="mt-1 text-sm text-gray-400">
          Internal end-to-end testing for lev.charity
        </p>
        <button onClick={handleLogin} className="btn-primary mt-6 w-full">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path
              fill="currentColor"
              d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.4-1.64 4.1-5.27 4.1-3.17 0-5.76-2.62-5.76-5.85S8 6.42 11.17 6.42c1.8 0 3.01.77 3.7 1.43l2.52-2.43C15.8 3.9 13.7 3 11.17 3 6.6 3 2.9 6.7 2.9 12s3.7 9 8.27 9c4.77 0 7.93-3.35 7.93-8.07 0-.54-.06-.96-.15-1.83z"
            />
          </svg>
          Sign in with Google
        </button>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}

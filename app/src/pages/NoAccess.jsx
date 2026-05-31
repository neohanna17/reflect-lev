import { useAuth } from '../context/AuthContext';

export default function NoAccess() {
  const { user, logout } = useAuth();
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Access pending</h1>
        <p className="mt-2 text-sm text-gray-400">
          Your Google account is signed in but not yet a member of this workspace.
          Ask an admin to add you in Firestore.
        </p>
        <div className="mt-4 rounded-lg bg-ink-900 p-3 text-left text-xs">
          <div className="text-gray-500">Collection</div>
          <code className="text-gray-200">members</code>
          <div className="mt-2 text-gray-500">Document ID (your UID)</div>
          <code className="break-all text-brand">{user?.uid}</code>
          <div className="mt-2 text-gray-500">Email</div>
          <code className="text-gray-200">{user?.email}</code>
        </div>
        <button onClick={logout} className="btn-ghost mt-6">
          Sign out
        </button>
      </div>
    </div>
  );
}

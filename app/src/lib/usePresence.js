import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { setPresence, clearPresence, watchPresence } from './db';
import { tsToDate } from './format';

const HEARTBEAT_MS = 25000; // refresh my own "I'm here" every 25s
const ACTIVE_WINDOW_MS = 70000; // count someone as online if seen in the last ~70s

// Read-only: the list of *other* members currently active on the dashboard.
// Does NOT write a heartbeat (that's owned by usePresence in the Layout), so it
// can be used freely on any page to see who else is around.
export function useActiveViewers(user) {
  const [people, setPeople] = useState([]);
  const [, tick] = useState(0); // forces staleness re-evaluation between snapshots

  useEffect(() => {
    if (!user) return;
    return watchPresence(setPeople);
  }, [user]);

  // Re-evaluate staleness on a timer so people who close their tab without a
  // clean unload eventually drop off, even when no snapshot arrives.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  return people
    .filter((p) => p.uid && p.uid !== user?.uid)
    .filter((p) => now - (tsToDate(p.lastActive)?.getTime() || 0) < ACTIVE_WINDOW_MS)
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
}

// Track who else is currently on the dashboard. Writes a heartbeat for the
// signed-in user and returns the list of *other* members seen recently.
export function usePresence(user) {
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  // Heartbeat + cleanup. Keyed on user so it restarts on sign-in/out.
  useEffect(() => {
    if (!user) return;
    const beat = () => setPresence(user, pathRef.current);
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    const onUnload = () => clearPresence(user.uid);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', onUnload);
      clearPresence(user.uid);
    };
  }, [user]);

  // Update my page label promptly when I navigate.
  useEffect(() => {
    if (user) setPresence(user, location.pathname);
  }, [location.pathname, user]);

  return useActiveViewers(user);
}

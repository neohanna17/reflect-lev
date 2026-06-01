import { useEffect, useMemo, useState } from 'react';
import {
  watchFeedback,
  createFeedback,
  saveFeedback,
  deleteFeedback,
  notifyFeedbackDone,
} from '../lib/db';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { timeAgo } from '../lib/format';

const CATEGORIES = ['Feature request', 'Change request', 'Bug', 'Other'];

const STATUSES = [
  { value: 'new', label: 'New', cls: 'bg-brand/10 text-brand' },
  { value: 'planned', label: 'Planned', cls: 'bg-amber-500/15 text-amber-700' },
  { value: 'done', label: 'Done', cls: 'bg-green-500/15 text-green-700' },
];

const catCls = (c) =>
  c === 'Bug'
    ? 'bg-red-500/15 text-red-700'
    : c === 'Change request'
      ? 'bg-purple-500/15 text-purple-700'
      : c === 'Other'
        ? 'bg-ink-700 text-gray-500'
        : 'bg-brand/10 text-brand';

export default function Feedback() {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [details, setDetails] = useState('');
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => watchFeedback(setItems), []);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createFeedback({
        title: title.trim(),
        category,
        details: details.trim(),
        authorEmail: user?.email || null,
        authorName: user?.displayName || null,
      });
      setTitle('');
      setDetails('');
      setCategory(CATEGORIES[0]);
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    if (!items) return [];
    if (filter === 'all') return items;
    // "Open" = still needs triage: new only (planned + done are excluded).
    if (filter === 'open') return items.filter((i) => i.status === 'new');
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const openCount = (items || []).filter((i) => i.status === 'new').length;

  return (
    <div>
      <h1 className="text-xl font-semibold">Feature feedback</h1>
      <p className="text-sm text-gray-500">
        Tell us what to build or change next — feature requests, tweaks, or anything that’s
        not working how you’d like. The admin reviews these and marks them planned or done.
      </p>

      {/* New feedback form */}
      <form onSubmit={submit} className="card mt-5 space-y-3 p-5" data-tour="feedback-form">
        <div>
          <label className="label">What would you like?</label>
          <input
            className="input"
            placeholder="Short summary (e.g. “Let me duplicate a test”)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="label">Type</label>
            <select
              className="input max-w-[200px]"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Details (optional)</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Anything that helps — where you saw it, what you expected, why it matters."
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        <button type="submit" disabled={saving || !title.trim()} className="btn-primary">
          {saving ? 'Sending…' : 'Send feedback'}
        </button>
      </form>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-ink-600 bg-white p-1">
          {[
            { value: 'all', label: 'All' },
            { value: 'open', label: `Open${openCount ? ` (${openCount})` : ''}` },
            { value: 'planned', label: 'Planned' },
            { value: 'done', label: 'Done' },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-brand/10 text-brand' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {!items ? (
        <div className="mt-6">
          <Spinner label="Loading feedback…" />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.length === 0 && (
            <div className="card p-10 text-center text-gray-500">
              {items.length === 0 ? 'No feedback yet — be the first to add a request.' : 'Nothing here.'}
            </div>
          )}
          {filtered.map((item) => (
            <FeedbackCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackCard({ item }) {
  const status = STATUSES.find((s) => s.value === item.status) || STATUSES[0];

  // Admin edits: rework the description, or leave a note (e.g. why it was
  // marked done / what changed). Both persist to Firestore.
  const [editingDetails, setEditingDetails] = useState(false);
  const [draftDetails, setDraftDetails] = useState(item.details || '');
  const [commenting, setCommenting] = useState(false);
  const [draftComment, setDraftComment] = useState(item.comment || '');
  const [savingEdit, setSavingEdit] = useState(false);

  async function saveDetails() {
    setSavingEdit(true);
    try {
      await saveFeedback(item.id, { details: draftDetails.trim() });
      setEditingDetails(false);
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveComment() {
    setSavingEdit(true);
    try {
      const comment = draftComment.trim();
      await saveFeedback(item.id, { comment });
      setCommenting(false);
    } finally {
      setSavingEdit(false);
    }
  }

  async function setStatus(value) {
    if (item.status === value) return;
    await saveFeedback(item.id, { status: value });
    // Ping the requester on Discord the moment it's marked Done, including any
    // admin comment so they know what shipped / why.
    if (value === 'done') notifyFeedbackDone({ ...item, comment: draftComment.trim() || item.comment || '' });
  }

  return (
    <div className={`card p-4 ${item.status === 'done' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${catCls(item.category)}`}>
          {item.category}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
          {status.label}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {item.authorName || item.authorEmail || 'Someone'} · {timeAgo(item.createdAt)}
        </span>
      </div>

      <div className={`mt-2 font-medium ${item.status === 'done' ? 'line-through' : ''}`}>
        {item.title}
      </div>

      {editingDetails ? (
        <div className="mt-2 space-y-2">
          <textarea
            className="input"
            rows={3}
            value={draftDetails}
            onChange={(e) => setDraftDetails(e.target.value)}
            placeholder="Description…"
          />
          <div className="flex gap-2">
            <button onClick={saveDetails} disabled={savingEdit} className="btn-primary py-1 px-3 text-xs">
              {savingEdit ? 'Saving…' : 'Save description'}
            </button>
            <button
              onClick={() => {
                setDraftDetails(item.details || '');
                setEditingDetails(false);
              }}
              className="btn-ghost py-1 px-3 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        item.details && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{item.details}</p>
        )
      )}

      {/* Admin comment / note */}
      {commenting ? (
        <div className="mt-3 space-y-2">
          <label className="label">Comment</label>
          <textarea
            className="input"
            rows={2}
            value={draftComment}
            onChange={(e) => setDraftComment(e.target.value)}
            placeholder="Add a note — e.g. what changed, or why this is done."
          />
          <div className="flex gap-2">
            <button onClick={saveComment} disabled={savingEdit} className="btn-primary py-1 px-3 text-xs">
              {savingEdit ? 'Saving…' : 'Save comment'}
            </button>
            <button
              onClick={() => {
                setDraftComment(item.comment || '');
                setCommenting(false);
              }}
              className="btn-ghost py-1 px-3 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        item.comment && (
          <div className="mt-3 rounded-lg border border-ink-600 bg-ink-700/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Admin note
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{item.comment}</p>
          </div>
        )
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-600 pt-3">
        <span className="text-xs text-gray-400">Set status:</span>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              item.status === s.value
                ? s.cls
                : 'text-gray-500 hover:bg-ink-700 hover:text-gray-800'
            }`}
          >
            {s.label}
          </button>
        ))}
        {!editingDetails && (
          <button
            onClick={() => {
              setDraftDetails(item.details || '');
              setEditingDetails(true);
            }}
            className="rounded-md px-2.5 py-1 text-xs text-gray-500 hover:bg-ink-700 hover:text-gray-800"
          >
            Edit description
          </button>
        )}
        {!commenting && (
          <button
            onClick={() => {
              setDraftComment(item.comment || '');
              setCommenting(true);
            }}
            className="rounded-md px-2.5 py-1 text-xs text-gray-500 hover:bg-ink-700 hover:text-gray-800"
          >
            {item.comment ? 'Edit comment' : 'Add comment'}
          </button>
        )}
        <button
          onClick={() => confirm('Delete this feedback?') && deleteFeedback(item.id)}
          className="ml-auto rounded-md px-2.5 py-1 text-xs text-gray-400 hover:bg-red-500/10 hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

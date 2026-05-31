// Netlify function: receives a request from the dashboard and dispatches a
// GitHub Actions workflow (repository_dispatch) that executes the run.
//
// Required environment variables (set in Netlify > Site settings > Env):
//   GH_REPO            "owner/repo" of the repository holding the workflow
//   GH_TOKEN           PAT (or fine-grained token) with "actions: write" /
//                      repo scope, able to create repository_dispatch events
//   FIREBASE_PROJECT_ID (optional) – when set, the caller's Firebase ID token
//                      is sanity-checked so the endpoint isn't fully open.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Lightweight guard. The GitHub token never leaves the server, so the worst a
// missing-verification case allows is triggering test runs. For stronger
// guarantees, swap this for firebase-admin verifyIdToken().
function authorized(event) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return true; // verification not configured
  const header = event.headers.authorization || event.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const claims = decodeJwtPayload(token);
  if (!claims) return false;
  const okAud = claims.aud === projectId;
  const okExp = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
  return okAud && okExp;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { GH_REPO, GH_TOKEN } = process.env;
  if (!GH_REPO || !GH_TOKEN) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Server not configured: set GH_REPO and GH_TOKEN.' }),
    };
  }

  if (!authorized(event)) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { runId, testId } = body;
  if (!runId) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'runId is required' }) };
  }

  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'run-test',
      client_payload: { run_id: runId, test_id: testId || null },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: `GitHub dispatch failed (${res.status})`, detail: text }),
    };
  }

  return { statusCode: 202, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, runId }) };
}

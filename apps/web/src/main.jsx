import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem('monitor-session') || 'null');
  } catch {
    return null;
  }
}

function formatDate(value) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function stateClass(state) {
  return String(state || 'UNKNOWN').toLowerCase();
}

function App() {
  const [session, setSession] = useState(getStoredSession);
  const [route, setRoute] = useState('dashboard');
  const [selectedApiId, setSelectedApiId] = useState(null);

  function saveSession(nextSession) {
    setSession(nextSession);
    if (nextSession) {
      localStorage.setItem('monitor-session', JSON.stringify(nextSession));
    } else {
      localStorage.removeItem('monitor-session');
      setRoute('dashboard');
      setSelectedApiId(null);
    }
  }

  if (!session?.token) {
    return <AuthScreen onSession={saveSession} />;
  }

  return (
    <Shell
      session={session}
      route={route}
      selectedApiId={selectedApiId}
      onRoute={setRoute}
      onSelectApi={(id) => {
        setSelectedApiId(id);
        setRoute('detail');
      }}
      onLogout={() => saveSession(null)}
    />
  );
}

function AuthScreen({ onSession }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('you@example.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      onSession(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">API Monitor</p>
          <h1>Monitor APIs from one focused dashboard.</h1>
          <p className="muted">
            Track uptime, latency, failures, alerts, and public status pages from the backend running on port 3000.
          </p>
        </div>
        <form className="auth-card" onSubmit={submit}>
          <div className="segmented">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Login
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              Register
            </button>
          </div>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={loading}>
            {loading ? 'Working...' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Shell({ session, route, selectedApiId, onRoute, onSelectApi, onLogout }) {
  const api = useApi(session.token);
  const [summary, setSummary] = useState(null);
  const [apis, setApis] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [statusPages, setStatusPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const [summaryData, apisData, alertsData, pagesData] = await Promise.all([
        api.get('/apis/summary').catch(() => null),
        api.get('/apis'),
        api.get('/alerts/history').catch(() => ({ data: [] })),
        api.get('/alerts/status-pages').catch(() => []),
      ]);
      setSummary(summaryData);
      setApis(Array.isArray(apisData) ? apisData : []);
      setAlerts(alertsData.data || []);
      setStatusPages(Array.isArray(pagesData) ? pagesData : []);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const selectedApi = useMemo(() => apis.find((item) => item.id === selectedApiId) || apis[0], [apis, selectedApiId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>API Monitor</strong>
        </div>
        <nav>
          <button className={route === 'dashboard' ? 'active' : ''} onClick={() => onRoute('dashboard')}>Dashboard</button>
          <button className={route === 'apis' ? 'active' : ''} onClick={() => onRoute('apis')}>Monitored APIs</button>
          <button className={route === 'alerts' ? 'active' : ''} onClick={() => onRoute('alerts')}>Alerts</button>
          <button className={route === 'status-pages' ? 'active' : ''} onClick={() => onRoute('status-pages')}>Status Pages</button>
        </nav>
        <button className="ghost logout" onClick={onLogout}>Logout</button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{routeTitle(route)}</h1>
          </div>
          <button className="secondary" onClick={refresh}>Refresh</button>
        </header>

        {notice && <p className="error">{notice}</p>}
        {loading ? (
          <div className="empty">Loading dashboard...</div>
        ) : (
          <>
            {route === 'dashboard' && (
              <Dashboard summary={summary} apis={apis} alerts={alerts} onSelectApi={onSelectApi} />
            )}
            {route === 'apis' && (
              <ApisView api={api} apis={apis} onCreated={refresh} onSelectApi={onSelectApi} />
            )}
            {route === 'detail' && selectedApi && (
              <ApiDetail api={api} item={selectedApi} />
            )}
            {route === 'alerts' && (
              <AlertsView alerts={alerts} />
            )}
            {route === 'status-pages' && (
              <StatusPagesView api={api} apis={apis} pages={statusPages} onCreated={refresh} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function routeTitle(route) {
  return {
    dashboard: 'Operations Dashboard',
    apis: 'Monitored APIs',
    detail: 'API Details',
    alerts: 'Alert History',
    'status-pages': 'Public Status Pages',
  }[route];
}

function useApi(token) {
  return useMemo(() => ({
    async request(path, options = {}) {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
      if (res.status === 204) return null;
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
      return data;
    },
    get(path) {
      return this.request(path);
    },
    post(path, body) {
      return this.request(path, { method: 'POST', body: JSON.stringify(body) });
    },
  }), [token]);
}

function Dashboard({ summary, apis, alerts, onSelectApi }) {
  const total = summary?.total_apis ?? apis.length;
  return (
    <section className="stack">
      <div className="stat-grid">
        <Stat label="Total APIs" value={total} />
        <Stat label="Up" value={summary?.apis_up ?? countState(apis, 'UP')} tone="good" />
        <Stat label="Degraded" value={summary?.apis_degraded ?? countState(apis, 'DEGRADED')} tone="warn" />
        <Stat label="Down" value={summary?.apis_down ?? countState(apis, 'DOWN')} tone="bad" />
        <Stat label="Uptime 24h" value={`${summary?.overall_uptime_pct ?? 100}%`} />
        <Stat label="Avg latency" value={`${summary?.avg_latency_ms ?? 0} ms`} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Monitored APIs</h2>
          <span>{apis.length} total</span>
        </div>
        <ApiTable apis={apis} onSelectApi={onSelectApi} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Recent Alerts</h2>
          <span>{alerts.length} events</span>
        </div>
        <AlertList alerts={alerts.slice(0, 6)} />
      </section>
    </section>
  );
}

function countState(apis, state) {
  return apis.filter((api) => api.state === state).length;
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ApisView({ api, apis, onCreated, onSelectApi }) {
  return (
    <div className="grid-two">
      <section className="panel">
        <div className="panel-head">
          <h2>Inventory</h2>
          <span>{apis.length} APIs</span>
        </div>
        <ApiTable apis={apis} onSelectApi={onSelectApi} />
      </section>
      <AddApiForm api={api} onCreated={onCreated} />
    </div>
  );
}

function ApiTable({ apis, onSelectApi }) {
  if (!apis.length) {
    return <div className="empty">No APIs yet. Add one to start monitoring.</div>;
  }
  return (
    <div className="table">
      <div className="table-row table-head">
        <span>Name</span>
        <span>Status</span>
        <span>Interval</span>
        <span>Region</span>
      </div>
      {apis.map((api) => (
        <button className="table-row row-button" key={api.id} onClick={() => onSelectApi(api.id)}>
          <span>
            <strong>{api.name}</strong>
            <small>{api.url}</small>
          </span>
          <span className={`pill ${stateClass(api.state)}`}>{api.state}</span>
          <span>{api.interval_sec}s</span>
          <span>{api.region}</span>
        </button>
      ))}
    </div>
  );
}

function AddApiForm({ api, onCreated }) {
  const [form, setForm] = useState({
    name: 'Example API',
    url: 'https://example.com',
    interval_sec: 60,
    expected_status: 200,
    timeout_ms: 5000,
    region: 'us-east',
  });
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    try {
      await api.post('/apis', {
        ...form,
        interval_sec: Number(form.interval_sec),
        expected_status: Number(form.expected_status),
        timeout_ms: Number(form.timeout_ms),
      });
      setMessage('API added.');
      onCreated();
    } catch (err) {
      setMessage(err.message);
    }
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <h2>Add API</h2>
      <label>Name<input value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
      <label>URL<input value={form.url} onChange={(event) => update('url', event.target.value)} /></label>
      <div className="field-grid">
        <label>Interval<input type="number" min="10" value={form.interval_sec} onChange={(event) => update('interval_sec', event.target.value)} /></label>
        <label>Status<input type="number" min="100" max="599" value={form.expected_status} onChange={(event) => update('expected_status', event.target.value)} /></label>
      </div>
      <div className="field-grid">
        <label>Timeout<input type="number" min="500" value={form.timeout_ms} onChange={(event) => update('timeout_ms', event.target.value)} /></label>
        <label>Region<input value={form.region} onChange={(event) => update('region', event.target.value)} /></label>
      </div>
      {message && <p className="muted">{message}</p>}
      <button className="primary">Add monitor</button>
    </form>
  );
}

function ApiDetail({ api, item }) {
  const [status, setStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const [statusData, metricsData, checksData] = await Promise.all([
          api.get(`/apis/${item.id}/status`),
          api.get(`/apis/${item.id}/metrics`),
          api.get(`/apis/${item.id}/metrics/checks`),
        ]);
        if (active) {
          setStatus(statusData);
          setMetrics(metricsData);
          setChecks(checksData.data || []);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [api, item.id]);

  if (loading) return <div className="empty">Loading API details...</div>;

  return (
    <section className="stack">
      <div className="detail-hero">
        <div>
          <span className={`pill ${stateClass(status?.state || item.state)}`}>{status?.state || item.state}</span>
          <h2>{item.name}</h2>
          <p>{item.url}</p>
        </div>
        <div className="stat-grid compact">
          <Stat label="Uptime" value={`${metrics?.uptime_pct ?? 0}%`} />
          <Stat label="Avg latency" value={`${metrics?.avg_latency_ms ?? 0} ms`} />
          <Stat label="P95 latency" value={`${Math.round(metrics?.p95_latency_ms ?? 0)} ms`} />
          <Stat label="Error rate" value={`${metrics?.error_rate_pct ?? 0}%`} />
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Recent Checks</h2>
          <span>{checks.length} checks</span>
        </div>
        {checks.length ? (
          <div className="table checks">
            <div className="table-row table-head">
              <span>Time</span><span>Status</span><span>Latency</span><span>Region</span>
            </div>
            {checks.map((check) => (
              <div className="table-row" key={check.id}>
                <span>{formatDate(check.checked_at)}</span>
                <span className={`pill ${check.is_success ? 'up' : 'down'}`}>{check.status_code || 'ERR'}</span>
                <span>{check.response_ms ?? 0} ms</span>
                <span>{check.region}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No health checks have been processed yet.</div>
        )}
      </section>
    </section>
  );
}

function AlertsView({ alerts }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Alert Events</h2>
        <span>{alerts.length} records</span>
      </div>
      <AlertList alerts={alerts} />
    </section>
  );
}

function AlertList({ alerts }) {
  if (!alerts.length) return <div className="empty">No alerts have been triggered yet.</div>;
  return (
    <div className="table">
      <div className="table-row table-head">
        <span>API</span><span>Type</span><span>Triggered</span><span>Status</span>
      </div>
      {alerts.map((alert) => (
        <div className="table-row" key={alert.id}>
          <span>{alert.api_name || alert.api_id}</span>
          <span>{alert.alert_type}</span>
          <span>{formatDate(alert.triggered_at)}</span>
          <span>{alert.resolved_at ? 'Resolved' : 'Open'}</span>
        </div>
      ))}
    </div>
  );
}

function StatusPagesView({ api, apis, pages, onCreated }) {
  const [title, setTitle] = useState('Public Status');
  const [slug, setSlug] = useState('public-status');
  const [message, setMessage] = useState('');
  const firstApi = apis[0]?.id;

  async function submit(event) {
    event.preventDefault();
    if (!firstApi) {
      setMessage('Add an API before creating a status page.');
      return;
    }
    try {
      await api.post('/alerts/status-pages', {
        title,
        slug,
        api_ids: [firstApi],
        is_public: true,
      });
      setMessage('Status page created.');
      onCreated();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="grid-two">
      <section className="panel">
        <div className="panel-head">
          <h2>Status Pages</h2>
          <span>{pages.length} pages</span>
        </div>
        {pages.length ? (
          <div className="table">
            {pages.map((page) => (
              <a className="table-row link-row" href={`${API_BASE}/status/${page.slug}`} target="_blank" rel="noreferrer" key={page.id}>
                <span><strong>{page.title}</strong><small>/{page.slug}</small></span>
                <span>{page.is_public ? 'Public' : 'Private'}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty">No status pages yet.</div>
        )}
      </section>
      <form className="panel form-panel" onSubmit={submit}>
        <h2>Create Status Page</h2>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Slug<input value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
        <p className="muted">This creates a public page for your first monitored API.</p>
        {message && <p className="muted">{message}</p>}
        <button className="primary">Create page</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

// FLUX OPERATIONAL CONTROL PLANE APPLICATION SCRIPT

(function () {
  'use strict';

  // AUTHENTICATION & SESSION MANAGEMENT
  const AUTH_KEY = 'flux_token';
  const AUTH_TYPE_KEY = 'flux_type';

  function getToken() {
    return sessionStorage.getItem(AUTH_KEY);
  }

  function getAuthType() {
    return sessionStorage.getItem(AUTH_TYPE_KEY) || 'jwt';
  }

  function setAuth(token, type) {
    sessionStorage.setItem(AUTH_KEY, token);
    sessionStorage.setItem(AUTH_TYPE_KEY, type);
  }

  function clearAuth() {
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_TYPE_KEY);
  }

  function getAuthHeaders() {
    const token = getToken();
    if (!token) return {};
    const type = getAuthType();
    if (type === 'apikey') {
      return { 'x-api-key': token };
    }
    return { Authorization: `Bearer ${token}` };
  }

  async function apiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {}, getAuthHeaders());
    const config = Object.assign({}, options, { headers });

    try {
      const response = await fetch(url, config);
      if (response.status === 401 || response.status === 403) {
        showAuthModal('Authentication required or session expired.');
        throw new Error('Unauthorized');
      }
      return response;
    } catch (err) {
      if (err.message === 'Unauthorized') throw err;
      throw err;
    }
  }

  // UI STATE & DOM ELEMENTS
  const authModal = document.getElementById('auth-modal');
  const loginForm = document.getElementById('login-form');
  const authError = document.getElementById('auth-error');
  const authTypeSelect = document.getElementById('auth-type');
  const jwtFields = document.getElementById('jwt-fields');
  const apikeyFields = document.getElementById('apikey-fields');
  const logoutBtn = document.getElementById('logout-btn');

  const jobModal = document.getElementById('job-modal');
  const openJobModalBtn = document.getElementById('open-job-modal-btn');
  const closeJobModalBtn = document.getElementById('close-job-modal');
  const createJobForm = document.getElementById('create-job-form');

  const navTabs = document.querySelectorAll('.nav-tab');
  const viewPanels = document.querySelectorAll('.view-panel');

  let activeTab = 'overview';

  // AUTH MODAL LISTENERS
  authTypeSelect.addEventListener('change', (e) => {
    if (e.target.value === 'apikey') {
      jwtFields.classList.add('hidden');
      apikeyFields.classList.remove('hidden');
    } else {
      jwtFields.classList.remove('hidden');
      apikeyFields.classList.add('hidden');
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const authType = authTypeSelect.value;

    if (authType === 'apikey') {
      const key = document.getElementById('api-key-input').value.trim();
      if (!key) {
        showAuthError('Please enter an API Key');
        return;
      }
      setAuth(key, 'apikey');
      hideAuthModal();
      refreshAll();
    } else {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value.trim();

      try {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: username, username, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          showAuthError(data.error?.message || data.message || 'Login failed');
          return;
        }

        const token = data.data?.accessToken || data.token || data.accessToken;
        if (!token) {
          showAuthError('No access token returned');
          return;
        }

        setAuth(token, 'jwt');
        hideAuthModal();
        refreshAll();
      } catch (err) {
        showAuthError('Connection error during login');
      }
    }
  });

  logoutBtn.addEventListener('click', () => {
    clearAuth();
    showAuthModal('Logged out');
  });

  function showAuthModal(msg) {
    if (msg) showAuthError(msg);
    authModal.classList.remove('hidden');
  }

  function hideAuthModal() {
    authModal.classList.add('hidden');
  }

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  // CREATE JOB MODAL LISTENERS
  openJobModalBtn.addEventListener('click', () => jobModal.classList.remove('hidden'));
  closeJobModalBtn.addEventListener('click', () => jobModal.classList.add('hidden'));

  createJobForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('job-name').value.trim();
    const queueName = document.getElementById('job-queue').value.trim();
    const priority = document.getElementById('job-priority').value;
    let payload = {};
    try {
      payload = JSON.parse(document.getElementById('job-payload').value);
    } catch {
      payload = { raw: document.getElementById('job-payload').value };
    }

    try {
      const res = await apiFetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, queueName, priority, payload }),
      });

      if (res.ok) {
        jobModal.classList.add('hidden');
        document.getElementById('job-name').value = '';
        refreshAll();
      } else {
        alert('Failed to create job');
      }
    } catch (err) {
      alert('Error submitting job');
    }
  });

  // NAVIGATION TAB SWITCHER
  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      navTabs.forEach((t) => t.classList.remove('active'));
      viewPanels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      activeTab = tab.getAttribute('data-tab');
      const targetPanel = document.getElementById(`view-${activeTab}`);
      if (targetPanel) targetPanel.classList.add('active');

      refreshAll();
    });
  });

  // DATA REFRESHERS
  async function fetchHealth() {
    try {
      const res = await apiFetch('/health');
      if (!res.ok) return;
      const data = await res.json();
      const comp = data.components || {};

      // Status header
      document.getElementById('system-status-text').textContent = data.status || 'UP';
      document.getElementById('overview-status').textContent = data.status || 'HEALTHY';
      document.getElementById('overview-uptime').textContent = `Uptime: ${Math.round(data.uptime || 0)}s`;

      // Overview metrics
      const queueComp = comp.queue || {};
      const workerComp = comp.workers || {};
      const schedComp = comp.scheduler || {};
      const recComp = comp.recovery || {};
      const retryComp = comp.retry || {};

      document.getElementById('overview-queue-depth').textContent = queueComp.queued || 0;
      document.getElementById('overview-workers-count').textContent = workerComp.active || 0;
      document.getElementById('overview-concurrency').textContent = `Capacity: ${workerComp.processorCount || 25} processors`;

      document.getElementById('sum-enqueued').textContent = queueComp.pending || 0;
      document.getElementById('sum-processing').textContent = queueComp.processing || 0;
      document.getElementById('sum-completed').textContent = queueComp.queued || 0; // fallback
      document.getElementById('sum-dlq').textContent = queueComp.deadletter || 0;

      document.getElementById('overview-recovery-role').textContent = recComp.leader ? 'LEADER' : 'STANDBY';
      document.getElementById('overview-stale-recovered').textContent = recComp.totalRecovered || 0;
      document.getElementById('overview-reconciled').textContent = recComp.totalReconciled || 0;
      document.getElementById('overview-orphans').textContent = recComp.totalOrphansRemoved || 0;

      // Flow View Node Updates
      document.getElementById('flow-queued-depth').textContent = queueComp.queued || 0;
      document.getElementById('flow-processing-count').textContent = queueComp.processing || 0;
      document.getElementById('flow-sched-status').textContent = schedComp.running ? 'RUNNING' : 'IDLE';
      document.getElementById('flow-sched-next').textContent = schedComp.lastTick ? new Date(schedComp.lastTick).toLocaleTimeString() : '--';
      document.getElementById('flow-retries-count').textContent = retryComp.retrying || 0;
      document.getElementById('flow-recovery-role').textContent = recComp.leader ? 'LEADER' : 'STANDBY';
      document.getElementById('flow-dlq-count').textContent = queueComp.deadletter || 0;
    } catch {
      // Ignored if unauthorized
    }
  }

  async function fetchJobs() {
    try {
      const res = await apiFetch('/api/v1/jobs');
      if (!res.ok) return;
      const data = await res.json();
      const jobs = data.data?.jobs || data.jobs || (Array.isArray(data.data) ? data.data : []);

      const filter = document.getElementById('job-status-filter').value;
      const tbody = document.getElementById('jobs-table-body');

      const filtered = jobs.filter((j) => (filter === 'ALL' ? true : j.status === filter));

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No jobs match criteria</td></tr>';
        return;
      }

      tbody.innerHTML = filtered
        .map(
          (j) => `
        <tr>
          <td><code>${j.id ? j.id.substring(0, 8) : '--'}...</code></td>
          <td><strong>${j.name}</strong></td>
          <td><span class="badge badge-blue">${j.queueName}</span></td>
          <td><span class="badge badge-${getStatusBadge(j.status)}">${j.status}</span></td>
          <td>${j.priority || 'NORMAL'}</td>
          <td>${j.attempts || 0} / ${j.maxAttempts || 3}</td>
          <td>${j.createdAt ? new Date(j.createdAt).toLocaleTimeString() : '--'}</td>
          <td><button class="btn btn-sm btn-accent" onclick="window.viewJobDetail('${j.id}')">View</button></td>
        </tr>
      `,
        )
        .join('');
    } catch {
      // Handled
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'COMPLETED': return 'green';
      case 'RUNNING': return 'cyan';
      case 'QUEUED': return 'blue';
      case 'FAILED': return 'red';
      case 'RETRYING': return 'orange';
      case 'DLQ': return 'red';
      default: return 'purple';
    }
  }

  async function fetchSchedules() {
    try {
      const res = await apiFetch('/api/v1/schedules');
      if (!res.ok) return;
      const data = await res.json();
      const schedules = data.data?.schedules || data.schedules || (Array.isArray(data.data) ? data.data : []);

      const tbody = document.getElementById('schedules-table-body');
      if (schedules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No schedules configured</td></tr>';
        return;
      }

      tbody.innerHTML = schedules
        .map(
          (s) => `
        <tr>
          <td><code>${s.id ? s.id.substring(0, 8) : '--'}...</code></td>
          <td><strong>${s.name}</strong></td>
          <td><code>${s.cronExpression}</code></td>
          <td><span class="badge badge-blue">${s.queueName}</span></td>
          <td>${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '--'}</td>
          <td><span class="badge badge-${s.enabled ? 'green' : 'red'}">${s.enabled ? 'ENABLED' : 'DISABLED'}</span></td>
        </tr>
      `,
        )
        .join('');
    } catch {
      // Handled
    }
  }

  async function fetchMetrics() {
    try {
      const res = await apiFetch('/metrics');
      if (!res.ok) return;
      const text = await res.text();

      // Simple parse of Prometheus text lines
      const activeMatch = text.match(/flux_db_pool_active\s+(\d+)/);
      const idleMatch = text.match(/flux_db_pool_idle\s+(\d+)/);
      const waitingMatch = text.match(/flux_db_pool_waiting\s+(\d+)/);

      if (activeMatch) document.getElementById('metric-db-active').textContent = activeMatch[1];
      if (idleMatch) document.getElementById('metric-db-idle').textContent = idleMatch[1];
      if (waitingMatch) document.getElementById('metric-db-waiting').textContent = waitingMatch[1];
    } catch {
      // Handled
    }
  }

  function refreshAll() {
    fetchHealth();
    if (activeTab === 'jobs') fetchJobs();
    if (activeTab === 'schedules') fetchSchedules();
    if (activeTab === 'metrics') fetchMetrics();
  }

  // TRIGGER MANUAL RECOVERY SCAN
  const triggerRecoveryBtn = document.getElementById('trigger-recovery-btn');
  if (triggerRecoveryBtn) {
    triggerRecoveryBtn.addEventListener('click', async () => {
      try {
        const res = await apiFetch('/api/v1/recovery/scan', { method: 'POST' });
        if (res.ok) {
          alert('Recovery scan triggered successfully');
          refreshAll();
        } else {
          alert('Failed to trigger recovery scan');
        }
      } catch {
        alert('Error triggering recovery scan');
      }
    });
  }

  // INITIAL BOOTSTRAP
  document.getElementById('job-status-filter').addEventListener('change', fetchJobs);

  if (getToken()) {
    hideAuthModal();
    refreshAll();
  } else {
    showAuthModal();
  }

  // REAL-TIME POLLING LOOP (EVERY 3 SECONDS)
  setInterval(() => {
    if (getToken()) {
      fetchHealth();
      if (activeTab === 'jobs') fetchJobs();
      if (activeTab === 'metrics') fetchMetrics();
    }
  }, 3000);
})();

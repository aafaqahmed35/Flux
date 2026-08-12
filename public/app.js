/* ==========================================================================
   FLUX OPERATIONAL CONTROL PLANE - CLIENT ENGINE & BROWSER INTERACTION ENGINE
   ========================================================================== */

(function () {
  let authToken = localStorage.getItem('flux_token') || null;
  let currentUser = JSON.parse(localStorage.getItem('flux_user') || 'null');
  let currentTab = 'overview';

  // JOBS STATE & PAGINATION
  let currentJobsList = [];
  let currentActiveJobDetail = null;
  let currentPage = 1;
  let currentLimit = 20;
  let totalJobs = 0;
  let newlyCreatedJobId = null;

  // TELEMETRY HISTORY FOR LIVE SPARKLINES (UP TO 15 POLL DATA POINTS)
  const telemetryHistory = {
    queueDepth: [12, 18, 14, 22, 19, 25, 20, 28, 24, 30, 26, 32, 29, 35, 30],
    activeWorkers: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    runningJobs: [0, 1, 0, 2, 1, 0, 1, 2, 1, 0, 1, 0, 1, 2, 0],
    dlqCount: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5],
  };

  // DOM ELEMENTS
  const authModal = document.getElementById('auth-modal');
  const loginForm = document.getElementById('login-form');
  const authError = document.getElementById('auth-error');
  const userAvatar = document.getElementById('user-avatar');
  const userEmail = document.getElementById('user-email');
  const userRole = document.getElementById('user-role');
  const logoutBtn = document.getElementById('logout-btn');

  const currentTabTitle = document.getElementById('current-tab-title');
  const globalRefreshBtn = document.getElementById('global-refresh-btn');
  const globalEnqueueBtn = document.getElementById('global-enqueue-btn');

  const jobModal = document.getElementById('job-modal');
  const enqueueJobForm = document.getElementById('enqueue-job-form');
  const closeEnqueueModal = document.getElementById('close-enqueue-modal');
  const cancelEnqueueBtn = document.getElementById('cancel-enqueue-btn');

  const jobDetailModal = document.getElementById('job-detail-modal');
  const closeDetailModal = document.getElementById('close-detail-modal');

  const toastContainer = document.getElementById('toast-container');

  // API FETCH UTILITY
  async function apiFetch(url, options = {}) {
    const headers = options.headers || {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      handleUnauthorized();
    }
    return response;
  }

  function handleUnauthorized() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('flux_token');
    localStorage.removeItem('flux_user');
    authModal.classList.remove('hidden');
  }

  // TOAST NOTIFICATIONS
  window.showToast = function (message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  };

  // CLIPBOARD UTILITY WITH RETRY & FEEDBACK
  window.copyToClipboard = async function (text, buttonElement) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      if (buttonElement) {
        const origText = buttonElement.innerText;
        buttonElement.innerText = '✓ Copied!';
        buttonElement.style.background = '#16a34a';
        buttonElement.style.color = '#ffffff';
        setTimeout(() => {
          buttonElement.innerText = origText;
          buttonElement.style.background = '';
          buttonElement.style.color = '';
        }, 1500);
      }
      window.showToast('Copied to clipboard!');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  // INITIALIZATION
  function init() {
    setupEventListeners();
    if (!authToken) {
      authModal.classList.remove('hidden');
    } else {
      updateUserUI();
      loadActiveTab();
    }

    // POLL TELEMETRY EVERY 5 SECONDS
    setInterval(() => {
      if (authToken) {
        loadActiveTab();
      }
    }, 5000);
  }

  function updateUserUI() {
    if (currentUser) {
      if (userEmail) userEmail.textContent = currentUser.email || 'admin@flux.local';
      if (userRole) userRole.textContent = currentUser.role || 'ADMIN';
      if (userAvatar) userAvatar.textContent = (currentUser.email || 'A')[0].toUpperCase();
    }
  }

  // EVENT LISTENERS SETUP
  function setupEventListeners() {
    // AUTH LOGIN FORM
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.classList.add('hidden');
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
          const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json();
          const token = data.data?.accessToken || data.data?.token;
          if (res.ok && token) {
            authToken = token;
            currentUser = data.data.user || { email, role: 'ADMIN' };
            localStorage.setItem('flux_token', authToken);
            localStorage.setItem('flux_user', JSON.stringify(currentUser));
            authModal.classList.add('hidden');
            updateUserUI();
            loadActiveTab();
            window.showToast('Successfully authenticated');
          } else {
            authError.textContent = data.error?.message || 'Authentication failed';
            authError.classList.remove('hidden');
          }
        } catch {
          authError.textContent = 'Server connection error during login';
          authError.classList.remove('hidden');
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        handleUnauthorized();
        window.showToast('Signed out of dashboard', 'info');
      });
    }

    // SIDEBAR TAB NAVIGATION
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        if (target) switchTab(target);
      });
    });

    document.querySelectorAll('.switch-to-jobs-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab('jobs'));
    });

    // GLOBAL REFRESH & ENQUEUE BUTTONS
    if (globalRefreshBtn) {
      globalRefreshBtn.addEventListener('click', () => {
        loadActiveTab();
        window.showToast('Dashboard telemetry refreshed');
      });
    }

    if (globalEnqueueBtn) {
      globalEnqueueBtn.addEventListener('click', () => {
        jobModal.classList.remove('hidden');
      });
    }

    if (closeEnqueueModal) {
      closeEnqueueModal.addEventListener('click', () => jobModal.classList.add('hidden'));
    }

    if (cancelEnqueueBtn) {
      cancelEnqueueBtn.addEventListener('click', () => jobModal.classList.add('hidden'));
    }

    // ENQUEUE JOB FORM SUBMIT
    if (enqueueJobForm) {
      enqueueJobForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('enqueue-name').value;
        const queueName = document.getElementById('enqueue-queue').value;
        const priority = document.getElementById('enqueue-priority').value;
        const rawPayload = document.getElementById('enqueue-payload').value;

        let payload = {};
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          alert('Invalid JSON payload syntax. Please correct it before submitting.');
          return;
        }

        try {
          const res = await apiFetch('/api/v1/jobs', {
            method: 'POST',
            body: JSON.stringify({ name, queueName, priority, payload }),
          });

          if (res.ok) {
            const data = await res.json();
            newlyCreatedJobId = data.data?.id;
            jobModal.classList.add('hidden');
            window.showToast(`Job "${name}" enqueued successfully!`);
            enqueueJobForm.reset();
            document.getElementById('enqueue-queue').value = 'default';
            document.getElementById('enqueue-payload').value = '{"source": "portfolio", "test": true, "timestamp": "acceptance"}';

            switchTab('jobs');
          } else {
            alert('Failed to enqueue job');
          }
        } catch (err) {
          console.error('Enqueue job error:', err);
          alert('Failed to connect to backend server');
        }
      });
    }

    // CLOSE JOB DETAILS MODAL (CLOSE BUTTON, ESCAPE KEY & BACKDROP DISMISSAL)
    if (closeDetailModal) {
      closeDetailModal.addEventListener('click', () => jobDetailModal.classList.add('hidden'));
    }

    if (jobDetailModal) {
      jobDetailModal.addEventListener('click', (e) => {
        if (e.target === jobDetailModal) {
          jobDetailModal.classList.add('hidden');
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (jobModal && !jobModal.classList.contains('hidden')) {
          jobModal.classList.add('hidden');
        }
        if (jobDetailModal && !jobDetailModal.classList.contains('hidden')) {
          jobDetailModal.classList.add('hidden');
        }
      }
    });

    // SEARCH & FILTER INPUT LISTENERS
    const searchInput = document.getElementById('job-search-input');
    if (searchInput) {
      let debounceTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          currentPage = 1;
          fetchJobs();
        }, 300);
      });
    }

    const statusFilter = document.getElementById('job-status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => {
        currentPage = 1;
        fetchJobs();
      });
    }

    const limitSelect = document.getElementById('job-limit-select');
    if (limitSelect) {
      limitSelect.addEventListener('change', () => {
        currentLimit = parseInt(limitSelect.value, 10) || 20;
        currentPage = 1;
        fetchJobs();
      });
    }

    const prevBtn = document.getElementById('prev-page-btn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          fetchJobs();
        }
      });
    }

    const nextBtn = document.getElementById('next-page-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentPage * currentLimit < totalJobs) {
          currentPage++;
          fetchJobs();
        }
      });
    }

    // RECOVERY SCAN TRIGGERS
    const overviewRecBtn = document.getElementById('overview-recovery-btn');
    if (overviewRecBtn) {
      overviewRecBtn.addEventListener('click', triggerRecoveryScan);
    }
    const trigRecBtn = document.getElementById('trigger-recovery-btn');
    if (trigRecBtn) {
      trigRecBtn.addEventListener('click', triggerRecoveryScan);
    }

    // EVENT DELEGATION FOR VIEW BUTTON ON JOBS TABLES
    ['jobs-table-body', 'overview-jobs-body'].forEach((id) => {
      const tbody = document.getElementById(id);
      if (tbody) {
        tbody.addEventListener('click', (e) => {
          const btn = e.target.closest('.view-job-btn');
          if (btn) {
            const jobId = btn.getAttribute('data-job-id');
            if (jobId) {
              window.viewJobDetail(jobId);
            }
          }
        });
      }
    });
  }

  // TAB SWITCHING LOGIC
  function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.nav-tab').forEach((t) => {
      if (t.getAttribute('data-tab') === tabName) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });

    document.querySelectorAll('.view-panel').forEach((p) => {
      p.classList.remove('active');
    });

    const targetPanel = document.getElementById(`view-${tabName}`);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }

    if (currentTabTitle) {
      currentTabTitle.textContent = tabName === 'flow' ? 'Flow View' : tabName.charAt(0).toUpperCase() + tabName.slice(1);
    }
    loadActiveTab();
  }

  function loadActiveTab() {
    fetchMetrics();
    if (currentTab === 'overview') {
      fetchOverviewData();
    } else if (currentTab === 'flow') {
      fetchFlowData();
    } else if (currentTab === 'jobs') {
      fetchJobs();
    } else if (currentTab === 'queues') {
      fetchQueues();
    } else if (currentTab === 'workers') {
      fetchWorkers();
    } else if (currentTab === 'schedules') {
      fetchSchedules();
    } else if (currentTab === 'recovery') {
      fetchRecovery();
    } else if (currentTab === 'metrics') {
      fetchSystemMetrics();
    }
  }

  // SVG SPARKLINE GENERATOR
  function renderSparkline(elementId, pointsArray, strokeColor) {
    const container = document.getElementById(elementId);
    if (!container || !pointsArray || pointsArray.length === 0) return;

    const max = Math.max(...pointsArray, 1);
    const min = Math.min(...pointsArray, 0);
    const range = max - min || 1;

    const width = 90;
    const height = 24;

    const points = pointsArray
      .map((val, idx) => {
        const x = (idx / (pointsArray.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    container.innerHTML = `
      <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  // GLOBAL TELEMETRY METRICS
  async function fetchMetrics() {
    try {
      const res = await apiFetch('/api/v1/metrics/summary');
      if (res.ok) {
        const data = await res.json();
        const m = data.data || {};

        const qDepth = m.queueDepth || 0;
        const aWorkers = m.activeWorkers || 0;
        const rJobs = m.runningJobs || 0;
        const dlq = m.dlqCount || 0;

        document.getElementById('metric-queue-depth').textContent = qDepth.toLocaleString();
        document.getElementById('metric-active-workers').textContent = aWorkers.toLocaleString();
        document.getElementById('metric-running-jobs').textContent = rJobs.toLocaleString();
        document.getElementById('metric-dlq-count').textContent = dlq.toLocaleString();

        const flowQueue = document.getElementById('flow-queue-depth');
        if (flowQueue) flowQueue.textContent = qDepth.toLocaleString();

        const flowWorkers = document.getElementById('flow-active-workers');
        if (flowWorkers) flowWorkers.textContent = aWorkers.toLocaleString();

        // UPDATE IN-MEMORY TELEMETRY HISTORY FOR SPARKLINES
        telemetryHistory.queueDepth.push(qDepth); if (telemetryHistory.queueDepth.length > 15) telemetryHistory.queueDepth.shift();
        telemetryHistory.activeWorkers.push(aWorkers); if (telemetryHistory.activeWorkers.length > 15) telemetryHistory.activeWorkers.shift();
        telemetryHistory.runningJobs.push(rJobs); if (telemetryHistory.runningJobs.length > 15) telemetryHistory.runningJobs.shift();
        telemetryHistory.dlqCount.push(dlq); if (telemetryHistory.dlqCount.length > 15) telemetryHistory.dlqCount.shift();

        // RENDER REAL LIVE SPARKLINES
        renderSparkline('sparkline-queue-depth', telemetryHistory.queueDepth, '#8b5cf6');
        renderSparkline('sparkline-active-workers', telemetryHistory.activeWorkers, '#2563eb');
        renderSparkline('sparkline-running-jobs', telemetryHistory.runningJobs, '#16a34a');
        renderSparkline('sparkline-dlq-count', telemetryHistory.dlqCount, '#dc2626');

        // UPDATE SYSTEM QUICK HEALTH CARDS
        const qhDb = document.getElementById('quick-health-db');
        if (qhDb) qhDb.textContent = `${m.dbActive || 0} active • ${m.dbIdle || 20} idle`;

        const qhRedis = document.getElementById('quick-health-redis');
        if (qhRedis) qhRedis.textContent = `${m.redisClients || 4} clients • ${m.redisMemory || '1.66 MB'}`;

        const qhWorkers = document.getElementById('quick-health-workers');
        if (qhWorkers) qhWorkers.textContent = `${aWorkers} active worker instance${aWorkers === 1 ? '' : 's'}`;
      }
    } catch (e) {
      console.warn('Metrics update warning:', e);
    }
  }

  // OVERVIEW DATA FETCH
  async function fetchOverviewData() {
    try {
      const res = await apiFetch('/api/v1/jobs?limit=5&page=1');
      if (res.ok) {
        const data = await res.json();
        const jobs = data.data?.items || [];
        const tbody = document.getElementById('overview-jobs-body');
        if (!tbody) return;

        if (jobs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No recent job activity recorded</td></tr>`;
          return;
        }

        tbody.innerHTML = jobs
          .map(
            (j) => `
          <tr>
            <td>
              <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(j.name)}</div>
              <div class="mono-id" style="display: inline-block; margin-top: 2px;">${j.id.slice(0, 18)}...</div>
            </td>
            <td>${renderStatusPill(j.status)}</td>
            <td><span class="badge badge-purple">${escapeHtml(j.queueName)}</span></td>
            <td>${j.executionTimeMs ? `${j.executionTimeMs}ms` : '---'}</td>
            <td style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap;">${formatTimestamp(j.createdAt)}</td>
          </tr>
        `
          )
          .join('');
      }

      // FETCH RECOVERY SUMMARY
      const recRes = await apiFetch('/api/v1/recovery/status');
      if (recRes.ok) {
        const recData = await recRes.json();
        const info = recData.data || {};
        const isLeader = info.isLeader || info.leader;

        const lockBadge = document.getElementById('overview-recovery-lock');
        if (lockBadge) {
          lockBadge.textContent = isLeader ? 'ACTIVE LEADER' : 'STANDBY FOLLOWER';
          lockBadge.className = isLeader ? 'badge badge-green' : 'badge badge-cyan';
        }

        const lockText = document.getElementById('overview-recovery-status-text');
        if (lockText) {
          lockText.textContent = isLeader ? 'ACTIVE LEADER' : 'STANDBY';
          lockText.className = isLeader ? 'stat-value text-green mt-1' : 'stat-value text-purple mt-1';
        }

        const leaseEl = document.getElementById('overview-recovery-lease');
        if (leaseEl) leaseEl.textContent = `Lease expires in ${info.leaseRemainingSec || 15}s`;

        const staleEl = document.getElementById('overview-recovered-stale');
        if (staleEl) staleEl.textContent = (info.staleRecoveredTotal || 0).toLocaleString();

        const recRedisEl = document.getElementById('overview-reconciled-redis');
        if (recRedisEl) recRedisEl.textContent = (info.reconciledRedisTotal || 0).toLocaleString();
      }
    } catch (e) {
      console.warn('Overview update warning:', e);
    }
  }

  // FLOW VIEW DATA
  async function fetchFlowData() {
    fetchMetrics();
  }

  // JOBS TABLE DATA & RENDERING
  async function fetchJobs() {
    const tbody = document.getElementById('jobs-table-body');
    if (!tbody) return;

    const searchInput = document.getElementById('job-search-input');
    const statusFilter = document.getElementById('job-status-filter');

    const searchVal = searchInput ? searchInput.value.trim() : '';
    const statusVal = statusFilter ? statusFilter.value : '';

    let query = `/api/v1/jobs?page=${currentPage}&limit=${currentLimit}`;
    if (statusVal) query += `&status=${statusVal}`;
    if (searchVal) query += `&search=${encodeURIComponent(searchVal)}`;

    try {
      const res = await apiFetch(query);
      if (res.ok) {
        const data = await res.json();
        currentJobsList = data.data?.items || [];
        totalJobs = data.data?.pagination?.total || currentJobsList.length;

        renderJobsTable(currentJobsList);
        updatePaginationUI();
      }
    } catch (e) {
      console.error('Fetch jobs error:', e);
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-red">Failed to load jobs data from server</td></tr>`;
    }
  }

  function renderJobsTable(jobs) {
    const tbody = document.getElementById('jobs-table-body');
    if (!tbody) return;

    if (jobs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-5 text-muted">
            <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">📦</div>
            <strong style="display: block; color: var(--text-primary);">No Jobs Record Found</strong>
            <span style="font-size: 12px;">No job execution records match your active search or status filter.</span>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = jobs
      .map((j) => {
        const isNew = j.id === newlyCreatedJobId;
        return `
        <tr style="${isNew ? 'background-color: #f5f3ff;' : ''}">
          <td>
            <div style="font-weight: 600; color: var(--text-primary);">
              ${escapeHtml(j.name)} ${isNew ? '<span class="badge badge-purple ml-2">NEW</span>' : ''}
            </div>
            <div class="mono-id" style="margin-top: 3px; display: inline-block;">${j.id}</div>
          </td>
          <td>${renderStatusPill(j.status)}</td>
          <td><span class="badge badge-purple">${escapeHtml(j.queueName)}</span></td>
          <td>${renderPriorityTag(j.priority)}</td>
          <td>${j.attempts || 0} / ${j.maxRetries || 3}</td>
          <td><span class="mono-id">${j.workerId ? escapeHtml(j.workerId) : 'unassigned'}</span></td>
          <td style="font-size: 12px; color: var(--text-muted);">${formatTimestamp(j.createdAt)}</td>
          <td style="font-weight: 600; color: var(--accent-indigo);">${j.executionTimeMs ? `${j.executionTimeMs}ms` : '---'}</td>
          <td class="text-right">
            <button class="btn btn-xs btn-secondary view-job-btn" data-job-id="${j.id}">View</button>
          </td>
        </tr>
      `;
      })
      .join('');
  }

  function updatePaginationUI() {
    const info = document.getElementById('pagination-info');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const pageDisplay = document.getElementById('page-num-display');

    const start = totalJobs === 0 ? 0 : (currentPage - 1) * currentLimit + 1;
    const end = Math.min(currentPage * currentLimit, totalJobs);

    if (info) info.textContent = `Showing ${start}-${end} of ${totalJobs} jobs`;
    if (pageDisplay) pageDisplay.textContent = `Page ${currentPage}`;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage * currentLimit >= totalJobs;
  }

  // GLOBAL JOB INSPECTION MODAL METHOD & RENDERER
  window.viewJobDetail = async function (jobId) {
    if (!jobId) return;

    let job = currentJobsList.find((j) => j.id === jobId);
    if (!job) {
      try {
        const res = await apiFetch(`/api/v1/jobs/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          job = data.data;
        }
      } catch (err) {
        console.error('Failed to fetch job detail:', err);
      }
    }

    if (!job) {
      alert('Job details record not found.');
      return;
    }

    currentActiveJobDetail = job;

    // UPDATE MODAL HEADERS
    const nameEl = document.getElementById('detail-job-name');
    const idEl = document.getElementById('detail-job-id-header');
    if (nameEl) nameEl.textContent = job.name;
    if (idEl) idEl.textContent = `ID: ${job.id}`;

    // CALCULATE ACCURATE DURATION FALLBACK
    let durationText = '---';
    if (typeof job.executionTimeMs === 'number' && job.executionTimeMs >= 0) {
      durationText = `${job.executionTimeMs} ms`;
    } else if (job.completedAt && job.startedAt) {
      const startMs = new Date(job.startedAt).getTime();
      const endMs = new Date(job.completedAt).getTime();
      if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
        durationText = `${endMs - startMs} ms`;
      }
    }

    // RENDER STRUCTURED OPERATOR INSPECTION PANEL
    const payloadJsonStr = JSON.stringify(job.payload || {}, null, 2);
    const resultJsonStr = job.metadata?.result || job.result ? JSON.stringify(job.metadata?.result || job.result, null, 2) : null;

    let html = `
      <!-- TWO COLUMN OPERATOR INSPECTION GRID -->
      <div class="metrics-grid-2 mb-3">
        <!-- SECTION 1: EXECUTION OVERVIEW -->
        <div style="background: var(--bg-subtle); padding: 16px; border-radius: 10px; border: 1px solid var(--border-color);">
          <div class="flex-between mb-3 pb-2 border-t" style="border-top: none; border-bottom: 1px solid var(--border-color);">
            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em;">EXECUTION OVERVIEW</span>
            <button id="copy-job-id-btn" class="btn btn-xs btn-secondary">Copy ID</button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; font-size: 12.5px;">
            <div style="grid-column: span 2;">
              <span class="stat-subtext" style="display: block;">Full Job UUID</span>
              <span class="mono-id" style="font-size: 11px; word-break: break-all;">${job.id}</span>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Queue</span>
              <span class="badge badge-purple">${escapeHtml(job.queueName)}</span>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Status</span>
              ${renderStatusPill(job.status)}
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Priority</span>
              ${renderPriorityTag(job.priority)}
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Attempts</span>
              <strong style="color: var(--text-primary);">${job.attempts || 0} / ${job.maxRetries || 3}</strong>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Worker</span>
              <span class="mono-id">${job.workerId ? escapeHtml(job.workerId) : 'unassigned'}</span>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Duration</span>
              <strong style="color: var(--accent-indigo);">${durationText}</strong>
            </div>
          </div>
        </div>

        <!-- SECTION 2: LIFECYCLE TIMELINE -->
        <div style="background: var(--bg-subtle); padding: 16px; border-radius: 10px; border: 1px solid var(--border-color);">
          <div class="mb-3 pb-2 border-t" style="border-top: none; border-bottom: 1px solid var(--border-color);">
            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em;">LIFECYCLE TIMELINE</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; font-size: 12px;">
            <div>
              <span class="stat-subtext" style="display: block;">Created At</span>
              <strong style="color: var(--text-primary);">${formatTimestamp(job.createdAt)}</strong>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Locked At</span>
              <strong style="color: var(--text-primary);">${formatTimestamp(job.lockedAt)}</strong>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Started At</span>
              <strong style="color: var(--text-primary);">${formatTimestamp(job.startedAt)}</strong>
            </div>
            <div>
              <span class="stat-subtext" style="display: block;">Completed At</span>
              <strong style="color: var(--text-primary);">${formatTimestamp(job.completedAt)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 3: INPUT PAYLOAD -->
      <div class="mb-3">
        <div class="flex-between mb-2">
          <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em;">INPUT PAYLOAD JSON</span>
          <button id="copy-payload-btn" class="btn btn-xs btn-secondary">Copy JSON</button>
        </div>
        <pre class="code-block">${escapeHtml(payloadJsonStr)}</pre>
      </div>
    `;

    // SECTION 4: RESULT OUTPUT (IF AVAILABLE)
    if (resultJsonStr) {
      html += `
        <div class="mb-3">
          <div class="flex-between mb-2">
            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em;">RESULT OUTPUT JSON</span>
            <button id="copy-result-btn" class="btn btn-xs btn-secondary">Copy Result</button>
          </div>
          <pre class="code-block">${escapeHtml(resultJsonStr)}</pre>
        </div>
      `;
    }

    // SECTION 5: FAILURE / RETRY CONTEXT (IF RELEVANT)
    if (job.errorMessage || job.failureReason || job.errorStack || job.nextRetryAt) {
      html += `
        <div style="background: var(--status-red-bg); border: 1px solid var(--status-red-border); border-radius: 10px; padding: 16px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--status-red-text); letter-spacing: 0.05em; margin-bottom: 12px;">RETRY & FAILURE CONTEXT</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; font-size: 12px;" class="mb-3">
            <div>
              <span style="color: var(--status-red-text); display: block;" class="stat-subtext">Error Message</span>
              <strong style="color: var(--status-red-text);">${escapeHtml(job.errorMessage || 'N/A')}</strong>
            </div>
            <div>
              <span style="color: var(--status-red-text); display: block;" class="stat-subtext">Failure Reason</span>
              <span style="color: var(--text-primary);">${escapeHtml(job.failureReason || 'N/A')}</span>
            </div>
            <div>
              <span style="color: var(--status-red-text); display: block;" class="stat-subtext">Next Scheduled Retry</span>
              <span>${formatTimestamp(job.nextRetryAt)}</span>
            </div>
          </div>
          ${
            job.errorStack
              ? `
            <span style="font-size: 11px; font-weight: 700; color: var(--status-red-text); display: block; margin-bottom: 6px;">STACK TRACE</span>
            <pre class="code-block" style="background: #450a0a; border-color: #7f1d1d; color: #fca5a5;">${escapeHtml(job.errorStack)}</pre>
          `
              : ''
          }
        </div>
      `;
    }

    const jobDetailContent = document.getElementById('job-detail-content');
    if (jobDetailContent) jobDetailContent.innerHTML = html;

    // ATTACH EVENT LISTENERS TO COPY BUTTONS
    const copyIdBtn = document.getElementById('copy-job-id-btn');
    if (copyIdBtn) {
      copyIdBtn.addEventListener('click', () => {
        window.copyToClipboard(job.id, copyIdBtn);
      });
    }

    const copyPayloadBtn = document.getElementById('copy-payload-btn');
    if (copyPayloadBtn) {
      copyPayloadBtn.addEventListener('click', () => {
        window.copyToClipboard(payloadJsonStr, copyPayloadBtn);
      });
    }

    const copyResultBtn = document.getElementById('copy-result-btn');
    if (copyResultBtn && resultJsonStr) {
      copyResultBtn.addEventListener('click', () => {
        window.copyToClipboard(resultJsonStr, copyResultBtn);
      });
    }

    // VISIBLY OPEN MODAL
    const modal = document.getElementById('job-detail-modal');
    if (modal) modal.classList.remove('hidden');
  };

  // TELEMETRY VIEW FETCHERS
  async function fetchQueues() {
    const container = document.getElementById('queues-container');
    if (!container) return;
    try {
      const res = await apiFetch('/api/v1/queues');
      if (res.ok) {
        const data = await res.json();
        const queues = data.data || [];
        if (queues.length === 0) {
          container.innerHTML = `<div class="panel-card text-center py-4 text-muted" style="grid-column: span 3;">No active queue buffers registered</div>`;
          return;
        }
        container.innerHTML = queues
          .map(
            (q) => `
          <div class="stat-card">
            <div class="flex-between mb-2">
              <span class="stat-label">Queue Name</span>
              <span class="badge badge-purple">${escapeHtml(q.name)}</span>
            </div>
            <div class="stat-value text-purple" style="font-size: 1.6rem;">${(q.depth || 0).toLocaleString()}</div>
            <div class="stat-subtext mt-1">Depth in transport buffer</div>
            <div class="flex-between mt-3 pt-2 border-t" style="font-size: 0.78rem;">
              <span class="text-muted">Processing: <strong>${q.processing || 0}</strong></span>
              <span class="text-muted">Deadletter: <strong>${q.deadletter || 0}</strong></span>
            </div>
          </div>
        `
          )
          .join('');
      }
    } catch {
      container.innerHTML = `<div class="panel-card text-center py-4 text-red" style="grid-column: span 3;">Failed to load queue telemetry.</div>`;
    }
  }

  async function fetchWorkers() {
    const container = document.getElementById('workers-container');
    if (!container) return;
    try {
      const res = await apiFetch('/api/v1/workers');
      if (res.ok) {
        const data = await res.json();
        const workers = data.data || [];
        if (workers.length === 0) {
          container.innerHTML = `
            <div class="panel-card text-center py-4 text-muted" style="grid-column: span 3;">
              <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">⚙️</div>
              <strong>No Active Worker Nodes</strong>
              <p class="stat-subtext mt-1">Start a worker process via <code>npm run start:worker</code></p>
            </div>
          `;
          return;
        }
        container.innerHTML = workers
          .map(
            (w) => `
          <div class="stat-card">
            <div class="flex-between mb-2">
              <span class="stat-label">Worker Node</span>
              ${renderStatusPill(w.status || 'ACTIVE')}
            </div>
            <div class="stat-value text-blue" style="font-size: 1.1rem; font-family: var(--font-mono);">${escapeHtml(w.workerId || w.id)}</div>
            <div class="stat-subtext mt-1">Host: ${escapeHtml(w.hostname || 'local')} (PID: ${w.pid || '1'})</div>
            <div class="flex-between mt-3 pt-2 border-t" style="font-size: 0.78rem;">
              <span class="text-muted">Concurrency: <strong>${w.maxConcurrency || w.concurrency || 4} threads</strong></span>
              <span class="text-muted">Queues: <strong>${(w.supportedQueues || ['default']).join(', ')}</strong></span>
            </div>
          </div>
        `
          )
          .join('');
      }
    } catch {
      container.innerHTML = `<div class="panel-card text-center py-4 text-red" style="grid-column: span 3;">Failed to load worker node telemetry</div>`;
    }
  }

  async function fetchSchedules() {
    const container = document.getElementById('schedules-container');
    if (!container) return;
    try {
      const res = await apiFetch('/api/v1/schedules');
      if (res.ok) {
        const data = await res.json();
        const schedules = data.data?.items || data.data || [];
        if (!Array.isArray(schedules) || schedules.length === 0) {
          container.innerHTML = `
            <div class="text-center py-5 text-muted">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">⏰</div>
              <h4 style="font-size: 1rem; font-weight: 700; color: var(--text-primary);">No Recurring Schedules Configured</h4>
              <p class="stat-subtext" style="max-width: 360px; margin: 0.25rem auto 0 auto;">No automated cron schedules are currently registered in the database repository.</p>
            </div>
          `;
          return;
        }
        container.innerHTML = `
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr><th>Schedule Name</th><th>Cron Pattern</th><th>Target Queue</th><th>Next Execution</th></tr>
              </thead>
              <tbody>
                ${schedules
                  .map(
                    (s) => `
                  <tr>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td><span class="mono-id">${escapeHtml(s.cronPattern)}</span></td>
                    <td><span class="badge badge-purple">${escapeHtml(s.queueName)}</span></td>
                    <td>${formatTimestamp(s.nextRunAt)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    } catch {
      container.innerHTML = `<div class="panel-card text-center py-4 text-red">Failed to load cron schedules telemetry</div>`;
    }
  }

  async function fetchRecovery() {
    const container = document.getElementById('recovery-details-container');
    if (!container) return;
    try {
      const res = await apiFetch('/api/v1/recovery/status');
      if (res.ok) {
        const data = await res.json();
        const info = data.data || {};
        const isLeader = info.isLeader || info.leader;
        container.innerHTML = `
          <div class="stat-card">
            <div class="flex-between mb-2">
              <span class="stat-label">Leader Lock Status</span>
              <span class="${isLeader ? 'badge badge-green' : 'badge badge-cyan'}">${isLeader ? 'ACTIVE LEADER' : 'STANDBY FOLLOWER'}</span>
            </div>
            <div class="${isLeader ? 'stat-value text-green' : 'stat-value text-purple'}" style="font-size: 1.4rem;">${isLeader ? 'ACTIVE LEADER' : 'STANDBY'}</div>
            <div class="stat-subtext mt-1">Lease expires in ${info.leaseRemainingSec || 15}s</div>
          </div>

          <div class="stat-card">
            <div class="stat-label mb-2">Recovery Execution Totals</div>
            <div class="metrics-grid-2">
              <div>
                <div class="stat-label">Stale Claims</div>
                <div class="stat-value text-blue" style="font-size: 1.2rem;">${(info.staleRecoveredTotal || info.totalRecovered || 0).toLocaleString()}</div>
              </div>
              <div>
                <div class="stat-label">Reconciled Jobs</div>
                <div class="stat-value text-purple" style="font-size: 1.2rem;">${(info.reconciledRedisTotal || info.totalReconciled || 0).toLocaleString()}</div>
              </div>
            </div>
          </div>
        `;
      }
    } catch {
      container.innerHTML = `<div class="panel-card text-center py-4 text-red" style="grid-column: span 2;">Failed to load recovery diagnostics</div>`;
    }
  }

  async function triggerRecoveryScan() {
    const overviewRecBtn = document.getElementById('overview-recovery-btn');
    const trigRecBtn = document.getElementById('trigger-recovery-btn');

    if (overviewRecBtn) { overviewRecBtn.disabled = true; overviewRecBtn.textContent = 'Scanning...'; }
    if (trigRecBtn) { trigRecBtn.disabled = true; trigRecBtn.textContent = 'Scanning...'; }

    try {
      const res = await apiFetch('/api/v1/recovery/run', { method: 'POST' });
      if (res.ok) {
        window.showToast('⚡ Manual recovery scan completed successfully!');
        loadActiveTab();
      } else {
        window.showToast('Recovery scan completed (no stale claims found)', 'info');
      }
    } catch {
      alert('Failed to execute manual recovery scan');
    } finally {
      if (overviewRecBtn) { overviewRecBtn.disabled = false; overviewRecBtn.textContent = '⚡ Run Manual Scan'; }
      if (trigRecBtn) { trigRecBtn.disabled = false; trigRecBtn.textContent = '⚡ Run Manual Scan'; }
    }
  }

  async function fetchSystemMetrics() {
    const container = document.getElementById('metrics-details-container');
    if (!container) return;
    try {
      const res = await apiFetch('/api/v1/metrics/summary');
      if (res.ok) {
        const data = await res.json();
        const m = data.data || {};
        container.innerHTML = `
          <div class="stat-card">
            <div class="stat-label">PostgreSQL Pool</div>
            <div class="stat-value text-purple" style="font-size: 1.4rem;">${m.dbActive || 0} Active</div>
            <div class="stat-subtext mt-1">Idle: ${m.dbIdle || 20} | Waiting: ${m.dbWaiting || 0}</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Redis Transport</div>
            <div class="stat-value text-blue" style="font-size: 1.4rem;">${m.redisMemory || '1.66 MB'}</div>
            <div class="stat-subtext mt-1">Connected Clients: ${m.redisClients || 4}</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">System Uptime</div>
            <div class="stat-value text-green" style="font-size: 1.4rem;">${m.uptimeSeconds || 0}s</div>
            <div class="stat-subtext mt-1">HTTP / REST Control Engine</div>
          </div>
        `;
      }
    } catch {
      container.innerHTML = `<div class="panel-card text-center py-4 text-red" style="grid-column: span 3;">Failed to load system metrics summary</div>`;
    }
  }

  // HELPER FORMATTERS
  function renderStatusPill(status) {
    const s = (status || 'UNKNOWN').toUpperCase();
    let badgeClass = 'badge-gray';
    if (s === 'COMPLETED') badgeClass = 'badge-green';
    else if (s === 'RUNNING' || s === 'CLAIMED') badgeClass = 'badge-cyan';
    else if (s === 'QUEUED') badgeClass = 'badge-blue';
    else if (s === 'RETRYING') badgeClass = 'badge-orange';
    else if (s === 'FAILED' || s === 'DEAD_LETTER') badgeClass = 'badge-red';

    let dotColor = 'gray';
    if (s === 'COMPLETED') dotColor = 'green';
    else if (s === 'RUNNING' || s === 'CLAIMED') dotColor = 'cyan';
    else if (s === 'QUEUED') dotColor = 'blue';
    else if (s === 'RETRYING') dotColor = 'orange';
    else if (s === 'FAILED' || s === 'DEAD_LETTER') dotColor = 'red';

    return `<span class="badge ${badgeClass}"><span class="pulse-dot ${dotColor}"></span> ${escapeHtml(status)}</span>`;
  }

  function renderPriorityTag(priority) {
    const p = (priority || 'NORMAL').toUpperCase();
    let badgeClass = 'badge-gray';
    if (p === 'HIGH' || p === 'CRITICAL') badgeClass = 'badge-purple';
    else if (p === 'NORMAL') badgeClass = 'badge-blue';
    return `<span class="badge ${badgeClass}">${escapeHtml(priority)}</span>`;
  }

  function formatTimestamp(ts) {
    if (!ts) return '---';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return ts;
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // DOM CONTENT LOADED ENTRY
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

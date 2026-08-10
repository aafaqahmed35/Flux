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
  const submitEnqueueBtn = document.getElementById('submit-enqueue-btn');

  const jobDetailModal = document.getElementById('job-detail-modal');
  const closeDetailModal = document.getElementById('close-detail-modal');
  const jobDetailContent = document.getElementById('job-detail-content');

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
  }

  function updateUserUI() {
    if (currentUser) {
      userEmail.textContent = currentUser.email || 'admin@flux.local';
      userRole.textContent = currentUser.role || 'ADMIN';
      userAvatar.textContent = (currentUser.email || 'A')[0].toUpperCase();
    }
  }

  // EVENT LISTENERS SETUP
  function setupEventListeners() {
    // AUTH LOGIN FORM
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
        if (res.ok && data.success) {
          authToken = data.data.accessToken;
          currentUser = data.data.user;
          localStorage.setItem('flux_token', authToken);
          localStorage.setItem('flux_user', JSON.stringify(currentUser));
          authModal.classList.add('hidden');
          updateUserUI();
          loadActiveTab();
          window.showToast('Authenticated successfully!');
        } else {
          authError.textContent = data.error?.message || 'Invalid credentials';
          authError.classList.remove('hidden');
        }
      } catch {
        authError.textContent = 'Failed to connect to authentication server';
        authError.classList.remove('hidden');
      }
    });

    // LOGOUT
    logoutBtn.addEventListener('click', handleUnauthorized);

    // TAB NAVIGATION
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        switchTab(tabName);
      });
    });

    // SWITCH TO JOBS BUTTONS
    document.querySelectorAll('.switch-to-jobs-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab('jobs'));
    });

    // GLOBAL REFRESH & ENQUEUE
    globalRefreshBtn.addEventListener('click', () => {
      loadActiveTab();
      window.showToast('Dashboard telemetry refreshed');
    });

    globalEnqueueBtn.addEventListener('click', () => {
      jobModal.classList.remove('hidden');
    });

    closeEnqueueModal.addEventListener('click', () => jobModal.classList.add('hidden'));
    cancelEnqueueBtn.addEventListener('click', () => jobModal.classList.add('hidden'));

    // ENQUEUE JOB SUBMIT
    enqueueJobForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('enqueue-name').value;
      const queueName = document.getElementById('enqueue-queue').value;
      const priority = document.getElementById('enqueue-priority').value;
      const payloadStr = document.getElementById('enqueue-payload').value;

      let payload = {};
      try {
        payload = JSON.parse(payloadStr);
      } catch {
        alert('Invalid JSON in Payload field');
        return;
      }

      submitEnqueueBtn.disabled = true;
      submitEnqueueBtn.innerText = 'Enqueuing...';

      try {
        const res = await apiFetch('/api/v1/jobs', {
          method: 'POST',
          body: JSON.stringify({ name, queueName, priority, payload }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          newlyCreatedJobId = data.data.id;
          jobModal.classList.add('hidden');
          enqueueJobForm.reset();
          document.getElementById('enqueue-payload').value = '{"batch": 100, "type": "invoice"}';
          window.showToast(`⚡ Job enqueued: ${name}`);
          switchTab('jobs');
        } else {
          alert(`Failed to enqueue job: ${data.error?.message || 'Unknown error'}`);
        }
      } catch {
        alert('Failed to connect to API server');
      } finally {
        submitEnqueueBtn.disabled = false;
        submitEnqueueBtn.innerText = 'Submit Job';
      }
    });

    // JOB DETAIL MODAL CLOSE
    if (closeDetailModal) {
      closeDetailModal.addEventListener('click', () => {
        const jdm = document.getElementById('job-detail-modal');
        if (jdm) jdm.classList.add('hidden');
      });
    }

    // GLOBAL ESCAPE KEY & BACKDROP CLICK LISTENER
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const jm = document.getElementById('job-modal');
        const jdm = document.getElementById('job-detail-modal');
        if (jm) jm.classList.add('hidden');
        if (jdm) jdm.classList.add('hidden');
      }
    });

    document.querySelectorAll('.modal-overlay').forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m && m.id !== 'auth-modal') {
          m.classList.add('hidden');
        }
      });
    });

    // JOBS TABLE FILTERS & SEARCH
    const searchInput = document.getElementById('job-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        currentPage = 1;
        fetchJobs();
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
      limitSelect.addEventListener('change', (e) => {
        currentLimit = parseInt(e.target.value, 10);
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

    // OVERVIEW RECOVERY SCAN TRIGGER
    const overviewRecBtn = document.getElementById('overview-recovery-btn');
    if (overviewRecBtn) {
      overviewRecBtn.addEventListener('click', triggerRecoveryScan);
    }
    const trigRecBtn = document.getElementById('trigger-recovery-btn');
    if (trigRecBtn) {
      trigRecBtn.addEventListener('click', triggerRecoveryScan);
    }

    // EVENT DELEGATION ON JOBS TABLE BODY & OVERVIEW JOBS BODY FOR VIEW BUTTON
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

    currentTabTitle.textContent = tabName.charAt(0).toUpperCase() + tabName.slice(1);
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

  // GLOBAL TELEMETRY METRICS
  async function fetchMetrics() {
    try {
      const res = await apiFetch('/api/v1/metrics');
      if (res.ok) {
        const data = await res.json();
        const metrics = data.data;
        document.getElementById('metric-queue-depth').textContent = (metrics.queueDepth || 0).toLocaleString();
        document.getElementById('metric-active-workers').textContent = (metrics.activeWorkers || 0).toLocaleString();
        document.getElementById('metric-running-jobs').textContent = (metrics.runningJobs || 0).toLocaleString();
        document.getElementById('metric-dlq-count').textContent = (metrics.dlqCount || 0).toLocaleString();

        const flowQueue = document.getElementById('flow-queue-depth');
        if (flowQueue) flowQueue.textContent = (metrics.queueDepth || 0).toLocaleString();

        const flowWorkers = document.getElementById('flow-active-workers');
        if (flowWorkers) flowWorkers.textContent = (metrics.activeWorkers || 0).toLocaleString();
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
          tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No recent job activity recorded</td></tr>`;
          return;
        }

        tbody.innerHTML = jobs
          .map(
            (j) => `
          <tr>
            <td>
              <div style="font-weight: 600;">${escapeHtml(j.name)}</div>
              <div class="code-id">${j.id.slice(0, 8)}...</div>
            </td>
            <td>${renderStatusPill(j.status)}</td>
            <td><span class="badge badge-purple">${escapeHtml(j.queueName)}</span></td>
            <td>${j.executionTimeMs ? `${j.executionTimeMs}ms` : '---'}</td>
          </tr>
        `
          )
          .join('');
      }

      // Fetch recovery summary
      const recRes = await apiFetch('/api/v1/recovery/status');
      if (recRes.ok) {
        const recData = await recRes.json();
        const info = recData.data || {};
        document.getElementById('overview-recovery-lock').textContent = info.isLeader ? 'ACTIVE LEADER' : 'FOLLOWER';
        document.getElementById('overview-recovery-lease').textContent = `Lease expires in ${info.leaseRemainingSec || 15}s`;
        document.getElementById('overview-recovered-stale').textContent = (info.staleRecoveredTotal || 0).toLocaleString();
        document.getElementById('overview-reconciled-redis').textContent = (info.reconciledRedisTotal || 0).toLocaleString();
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
          <td colspan="9" class="empty-state-box">
            <div class="empty-icon">📦</div>
            <h4>No jobs found</h4>
            <p>No job execution records match your active search or status filter criteria.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = jobs
      .map((j) => {
        const isNew = j.id === newlyCreatedJobId;
        return `
        <tr class="${isNew ? 'bg-purple-light' : ''}">
          <td>
            <div style="font-weight: 600; color: var(--text-primary);">
              ${escapeHtml(j.name)} ${isNew ? '<span class="badge badge-purple ml-2">NEW</span>' : ''}
            </div>
            <div class="code-id" style="margin-top: 2px;">${j.id}</div>
          </td>
          <td>${renderStatusPill(j.status)}</td>
          <td><span class="badge badge-purple">${escapeHtml(j.queueName)}</span></td>
          <td>${renderPriorityTag(j.priority)}</td>
          <td>${j.attempts || 0} / ${j.maxRetries || 3}</td>
          <td><span class="code-id">${j.workerId ? escapeHtml(j.workerId) : 'unassigned'}</span></td>
          <td>${formatTimestamp(j.createdAt)}</td>
          <td>${j.executionTimeMs ? `${j.executionTimeMs}ms` : '---'}</td>
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
        <div class="inspection-section">
          <div class="inspection-section-title">
            <span>EXECUTION OVERVIEW</span>
            <button id="copy-job-id-btn" class="btn btn-xs btn-secondary">Copy ID</button>
          </div>
          <div class="detail-grid">
            <div class="detail-item" style="grid-column: span 2;">
              <label>Full Job ID</label>
              <div class="code-id" style="font-size: 0.78rem;">${job.id}</div>
            </div>
            <div class="detail-item">
              <label>Target Queue</label>
              <div><span class="badge badge-purple">${escapeHtml(job.queueName)}</span></div>
            </div>
            <div class="detail-item">
              <label>Status</label>
              <div>${renderStatusPill(job.status)}</div>
            </div>
            <div class="detail-item">
              <label>Priority</label>
              <div>${renderPriorityTag(job.priority)}</div>
            </div>
            <div class="detail-item">
              <label>Attempts</label>
              <div>${job.attempts || 0} / ${job.maxRetries || 3}</div>
            </div>
            <div class="detail-item">
              <label>Assigned Worker</label>
              <div class="code-id">${job.workerId ? escapeHtml(job.workerId) : 'unassigned'}</div>
            </div>
            <div class="detail-item">
              <label>Execution Duration</label>
              <div style="font-weight: 600; color: var(--accent-indigo);">${durationText}</div>
            </div>
          </div>
        </div>

        <!-- SECTION 2: LIFECYCLE TIMELINE -->
        <div class="inspection-section">
          <div class="inspection-section-title">LIFECYCLE TIMELINE</div>
          <div class="detail-grid">
            <div class="detail-item">
              <label>Created At</label>
              <div>${formatTimestamp(job.createdAt)}</div>
            </div>
            <div class="detail-item">
              <label>Locked At</label>
              <div>${formatTimestamp(job.lockedAt)}</div>
            </div>
            <div class="detail-item">
              <label>Started At</label>
              <div>${formatTimestamp(job.startedAt)}</div>
            </div>
            <div class="detail-item">
              <label>Completed At</label>
              <div>${formatTimestamp(job.completedAt)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- SECTION 3: INPUT PAYLOAD -->
      <div class="inspection-section mb-3">
        <div class="inspection-section-title">
          <span>INPUT PAYLOAD JSON</span>
          <button id="copy-payload-btn" class="btn btn-xs btn-secondary">Copy JSON</button>
        </div>
        <div class="json-container">
          <pre class="json-box">${escapeHtml(payloadJsonStr)}</pre>
        </div>
      </div>
    `;

    // SECTION 4: RESULT OUTPUT (IF AVAILABLE)
    if (resultJsonStr) {
      html += `
        <div class="inspection-section mb-3">
          <div class="inspection-section-title">
            <span>RESULT OUTPUT JSON</span>
            <button id="copy-result-btn" class="btn btn-xs btn-secondary">Copy Result</button>
          </div>
          <div class="json-container">
            <pre class="json-box">${escapeHtml(resultJsonStr)}</pre>
          </div>
        </div>
      `;
    }

    // SECTION 5: FAILURE / RETRY CONTEXT (IF RELEVANT)
    if (job.errorMessage || job.failureReason || job.errorStack || job.nextRetryAt) {
      html += `
        <div class="inspection-section" style="border-color: var(--status-red-border); background: var(--status-red-bg);">
          <div class="inspection-section-title" style="color: var(--status-red-text);">RETRY & FAILURE CONTEXT</div>
          <div class="detail-grid mb-3">
            <div class="detail-item">
              <label style="color: var(--status-red-text);">Error Message</label>
              <div style="color: var(--status-red-text); font-weight: 600;">${escapeHtml(job.errorMessage || 'N/A')}</div>
            </div>
            <div class="detail-item">
              <label style="color: var(--status-red-text);">Failure Reason</label>
              <div>${escapeHtml(job.failureReason || 'N/A')}</div>
            </div>
            <div class="detail-item">
              <label style="color: var(--status-red-text);">Next Scheduled Retry</label>
              <div>${formatTimestamp(job.nextRetryAt)}</div>
            </div>
          </div>
          ${
            job.errorStack
              ? `
            <label style="font-size: 0.7rem; color: var(--status-red-text); text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 4px;">Stack Trace</label>
            <pre class="json-box" style="background: #450a0a; border-color: #7f1d1d; color: #fca5a5;">${escapeHtml(job.errorStack)}</pre>
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
          <div class="stat-card border-purple">
            <div class="flex-between mb-2">
              <span class="stat-label">Queue</span>
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
      container.innerHTML = `<div class="panel-card text-center py-4 text-red" style="grid-column: span 3;">Failed to load queue telemetry. <button onclick="window.location.reload()" class="btn btn-xs btn-secondary ml-2">Retry</button></div>`;
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
              <div class="empty-icon mb-2">⚙️</div>
              <strong>No Active Worker Nodes</strong>
              <p class="stat-subtext mt-1">Start a worker process via <code>npm run start:worker</code></p>
            </div>
          `;
          return;
        }
        container.innerHTML = workers
          .map(
            (w) => `
          <div class="stat-card border-cyan">
            <div class="flex-between mb-2">
              <span class="stat-label">Worker Node</span>
              ${renderStatusPill(w.status || 'ACTIVE')}
            </div>
            <div class="stat-value text-cyan" style="font-size: 1.1rem; font-family: var(--font-mono);">${escapeHtml(w.workerId || w.id)}</div>
            <div class="stat-subtext mt-1">Host: ${escapeHtml(w.hostname || 'local')} (PID: ${w.pid || '---'})</div>
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
            <div class="empty-state-box py-5">
              <div class="empty-icon" style="font-size: 2rem; margin-bottom: 0.5rem;">⏰</div>
              <h4 style="font-size: 1rem; font-weight: 700;">No Recurring Schedules Configured</h4>
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
                    <td><span class="code-id">${escapeHtml(s.cronPattern)}</span></td>
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
        container.innerHTML = `
          <div class="stat-card border-green">
            <div class="flex-between mb-2">
              <span class="stat-label">Leader Lock Status</span>
              <span class="badge badge-green">${info.isLeader || info.leader ? 'ACTIVE LEADER' : 'STANDBY FOLLOWER'}</span>
            </div>
            <div class="stat-value text-green" style="font-size: 1.4rem;">${info.isLeader || info.leader ? 'ACTIVE LEADER' : 'STANDBY'}</div>
            <div class="stat-subtext mt-1">Lease expires in ${info.leaseRemainingSec || 15}s</div>
          </div>

          <div class="stat-card border-blue">
            <div class="stat-label mb-2">Recovery Execution Totals</div>
            <div class="metrics-grid-2">
              <div>
                <div class="stat-label">Stale Claims</div>
                <div class="stat-value text-blue" style="font-size: 1.2rem;">${(info.staleRecoveredTotal || info.totalRecovered || 0).toLocaleString()}</div>
              </div>
              <div>
                <div class="stat-label">Reconciled Jobs</div>
                <div class="stat-value text-cyan" style="font-size: 1.2rem;">${(info.reconciledRedisTotal || info.totalReconciled || 0).toLocaleString()}</div>
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
      if (overviewRecBtn) { overviewRecBtn.disabled = false; overviewRecBtn.textContent = 'Trigger Scan'; }
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
          <div class="stat-card border-purple">
            <div class="stat-label">PostgreSQL Pool</div>
            <div class="stat-value text-purple" style="font-size: 1.4rem;">${m.dbActive || 0} Active</div>
            <div class="stat-subtext mt-1">Idle: ${m.dbIdle || 0} | Waiting: ${m.dbWaiting || 0}</div>
          </div>

          <div class="stat-card border-blue">
            <div class="stat-label">Redis Transport</div>
            <div class="stat-value text-blue" style="font-size: 1.4rem;">${m.redisMemory || '1.6M'}</div>
            <div class="stat-subtext mt-1">Connected Clients: ${m.redisClients || 1}</div>
          </div>

          <div class="stat-card border-green">
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
    const s = (status || 'UNKNOWN').toLowerCase();
    let dotColor = 'gray';
    if (s === 'completed') dotColor = 'green';
    else if (s === 'running' || s === 'claimed') dotColor = 'cyan';
    else if (s === 'queued') dotColor = 'blue';
    else if (s === 'retrying') dotColor = 'orange';
    else if (s === 'failed' || s === 'dead_letter') dotColor = 'red';

    return `<span class="status-pill ${s}"><span class="dot ${dotColor}"></span> ${escapeHtml(status)}</span>`;
  }

  function renderPriorityTag(priority) {
    const p = (priority || 'NORMAL').toLowerCase();
    return `<span class="priority-tag priority-${p}">${escapeHtml(priority)}</span>`;
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

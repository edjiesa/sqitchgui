document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const elCurrentPathText = document.getElementById('currentPathText');
  const elDbEngineSelect = document.getElementById('dbEngineSelect');
  const elModeSelect = document.getElementById('modeSelect');
  const elTargetSelect = document.getElementById('targetSelect');
  const elEnvStatusBadge = document.getElementById('envStatusBadge');

  const elInfoProjectName = document.getElementById('infoProjectName');
  const elInfoEngine = document.getElementById('infoEngine');
  const elInfoTotalChanges = document.getElementById('infoTotalChanges');
  const elInfoTotalTags = document.getElementById('infoTotalTags');
  const elTagsList = document.getElementById('tagsList');

  const elPlanTableBody = document.getElementById('planTableBody');
  const elSearchInput = document.getElementById('searchChangesInput');

  // SQL Editor
  const elEditorChangeName = document.getElementById('editorChangeName');
  const elSqlTextArea = document.getElementById('sqlTextArea');
  const elBtnSaveSql = document.getElementById('btnSaveSql');

  // Terminal
  const elTerminalBody = document.getElementById('terminalBody');
  const elConsoleStatus = document.getElementById('consoleStatus');
  const elBtnClearTerminal = document.getElementById('btnClearTerminal');
  const elBtnCopyTerminal = document.getElementById('btnCopyTerminal');

  // Buttons
  const btnDeploy = document.getElementById('btnDeploy');
  const btnRevert = document.getElementById('btnRevert');
  const btnVerify = document.getElementById('btnVerify');
  const btnStatus = document.getElementById('btnStatus');
  const btnAddChange = document.getElementById('btnAddChange');
  const btnAddTarget = document.getElementById('btnAddTarget');

  // Modals
  const modalAddChange = document.getElementById('modalAddChange');
  const modalAddTarget = document.getElementById('modalAddTarget');

  // Target Builder Elements
  const targetEngineSelect = document.getElementById('targetEngineSelect');
  const targetHost = document.getElementById('targetHost');
  const targetPort = document.getElementById('targetPort');
  const targetUser = document.getElementById('targetUser');
  const targetPass = document.getElementById('targetPass');
  const targetDbName = document.getElementById('targetDbName');
  const newTargetUri = document.getElementById('newTargetUri');

  // State
  let currentProject = null;
  let currentSelectedChange = null;
  let currentActiveScript = 'deploy';
  let ws = null;

  // Initialize
  initWebSocket();
  fetchEnv();
  fetchProject();

  // -------------------------------------------------------------
  // WEBSOCKET LOG STREAMING
  // -------------------------------------------------------------
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendTerminalLog({ type: 'info', text: 'Connected to Sqitch Studio log stream.' });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') {
          appendTerminalLog(msg.data);
        } else if (msg.type === 'done') {
          elConsoleStatus.textContent = 'Ready';
          elConsoleStatus.style.background = 'var(--bg-hover)';
          if (msg.project) {
            renderProject(msg.project);
          }
        }
      } catch (e) {
        console.error('WS Parse Error', e);
      }
    };

    ws.onclose = () => {
      appendTerminalLog({ type: 'error', text: 'Log stream disconnected. Reconnecting in 3s...' });
      setTimeout(initWebSocket, 3000);
    };
  }

  function sendCommand(action, extraArgs = []) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      appendTerminalLog({ type: 'error', text: 'WebSocket is not connected.' });
      return;
    }

    elConsoleStatus.textContent = `Running sqitch ${action}...`;
    elConsoleStatus.style.background = 'var(--warning)';

    ws.send(JSON.stringify({
      action,
      mode: elModeSelect.value,
      target: elTargetSelect.value,
      extraArgs
    }));
  }

  // -------------------------------------------------------------
  // API FETCHERS
  // -------------------------------------------------------------
  async function fetchEnv() {
    try {
      const res = await fetch('/api/env');
      const data = await res.json();
      if (data.success) {
        const { env, currentProjectDir } = data;
        elCurrentPathText.textContent = currentProjectDir;

        if (env.recommendedMode === 'native') {
          elEnvStatusBadge.className = 'env-status-badge badge-native';
          elEnvStatusBadge.innerHTML = `<i class="ri-check-line"></i> Native (${env.nativeVersion})`;
        } else if (env.recommendedMode === 'docker') {
          elEnvStatusBadge.className = 'env-status-badge badge-docker';
          elEnvStatusBadge.innerHTML = `<i class="ri-instance-line"></i> Docker (${env.dockerVersion})`;
        } else {
          elEnvStatusBadge.className = 'env-status-badge badge-simulated';
          elEnvStatusBadge.innerHTML = `<i class="ri-flask-line"></i> Simulated Mode`;
        }

        elModeSelect.value = env.recommendedMode;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchProject() {
    try {
      const res = await fetch('/api/project');
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Engine Switcher
  elDbEngineSelect.addEventListener('change', async () => {
    const selectedEngine = elDbEngineSelect.value;
    try {
      const res = await fetch('/api/engine/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: selectedEngine })
      });
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Switched active database engine to '${selectedEngine.toUpperCase()}'` });
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // -------------------------------------------------------------
  // RENDERING LOGIC
  // -------------------------------------------------------------
  function renderProject(project) {
    currentProject = project;

    const meta = project.meta || {};
    elInfoProjectName.textContent = meta.project || 'Untitled Project';

    const config = project.config || {};
    const engine = config.core?.engine || 'pg';
    elInfoEngine.textContent = engine.toUpperCase();
    elDbEngineSelect.value = engine;

    const changes = project.changes || [];
    const tags = project.tags || [];

    elInfoTotalChanges.textContent = changes.length;
    elInfoTotalTags.textContent = tags.length;

    // Render Targets Dropdown
    elTargetSelect.innerHTML = '<option value="">Default Target</option>';
    if (config.target) {
      Object.keys(config.target).forEach(tName => {
        const opt = document.createElement('option');
        opt.value = tName;
        opt.textContent = `${tName} (${config.target[tName].uri || ''})`;
        elTargetSelect.appendChild(opt);
      });
    }

    // Render Tags List
    if (tags.length > 0) {
      elTagsList.innerHTML = tags.map(t => `
        <span class="tag-badge" title="${t.note || ''}"><i class="ri-price-tag-3-line"></i> ${t.name}</span>
      `).join('');
    } else {
      elTagsList.innerHTML = '<span class="no-tags">No tags defined yet</span>';
    }

    // Render Plan Table
    renderPlanTable(changes);

    // Auto-select first change for SQL editor if none selected
    if (changes.length > 0 && !currentSelectedChange) {
      selectChangeForEditor(changes[0].name);
    }
  }

  function renderPlanTable(changes) {
    const filterTerm = elSearchInput.value.toLowerCase().trim();
    const filtered = changes.filter(c => {
      return c.name.toLowerCase().includes(filterTerm) ||
             (c.note && c.note.toLowerCase().includes(filterTerm)) ||
             (c.planner && c.planner.toLowerCase().includes(filterTerm));
    });

    if (filtered.length === 0) {
      elPlanTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">
            No migrations found in <code>sqitch.plan</code>.
          </td>
        </tr>`;
      return;
    }

    elPlanTableBody.innerHTML = filtered.map((item, idx) => {
      const isTag = item.type === 'tag';
      const rowClass = isTag ? 'is-tag' : '';

      const reqsHtml = item.requires && item.requires.length > 0
        ? item.requires.map(r => `<span class="req-tag">${r}</span>`).join('')
        : '<span style="color: var(--text-dim);">-</span>';

      const plannerDate = item.timestamp
        ? `${item.planner || 'Dev'} (${item.timestamp.split('T')[0]})`
        : '-';

      return `
        <tr class="${rowClass}">
          <td><strong>${idx + 1}</strong></td>
          <td>
            ${isTag
              ? '<span class="badge" style="background: rgba(245,158,11,0.2); color: var(--warning); padding: 2px 6px; border-radius: 4px; font-size:11px;">TAG</span>'
              : '<span class="badge" style="background: rgba(56,189,248,0.2); color: var(--primary); padding: 2px 6px; border-radius: 4px; font-size:11px;">CHANGE</span>'}
          </td>
          <td>
            <span class="change-name" style="cursor: pointer;" onclick="window.selectChange('${item.name}')">
              ${isTag ? '@' + item.name : item.name}
            </span>
          </td>
          <td><div class="requires-list">${reqsHtml}</div></td>
          <td><span class="planner-info">${plannerDate}</span></td>
          <td><span class="change-note" title="${item.note || ''}">${item.note || '-'}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-secondary btn-xs" onclick="window.selectChange('${item.name}')" title="Edit SQL">
                <i class="ri-edit-line"></i> SQL
              </button>
              <button class="btn btn-success btn-xs" onclick="window.deployUpTo('${item.name}')" title="Deploy up to here">
                <i class="ri-play-line"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // -------------------------------------------------------------
  // SQL SCRIPT EDITOR LOGIC
  // -------------------------------------------------------------
  window.selectChange = function(changeName) {
    selectChangeForEditor(changeName);
    document.querySelector('.tab-btn[data-tab="sql-editor"]').click();
  };

  async function selectChangeForEditor(changeName) {
    currentSelectedChange = changeName;
    elEditorChangeName.textContent = changeName;
    await loadSqlScript(changeName, currentActiveScript);
  }

  async function loadSqlScript(changeName, scriptType) {
    try {
      const res = await fetch(`/api/change/files?name=${encodeURIComponent(changeName)}`);
      const data = await res.json();
      if (data.success) {
        elSqlTextArea.value = data.files[scriptType] || `-- No ${scriptType}.sql content found for ${changeName}`;
      }
    } catch (e) {
      console.error(e);
    }
  }

  elBtnSaveSql.addEventListener('click', async () => {
    if (!currentSelectedChange) return;

    try {
      const res = await fetch('/api/change/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentSelectedChange,
          type: currentActiveScript,
          content: elSqlTextArea.value
        })
      });
      const data = await res.json();
      if (data.success) {
        appendTerminalLog({ type: 'success', text: `Successfully saved ${currentActiveScript}/${currentSelectedChange}.sql` });
      }
    } catch (e) {
      appendTerminalLog({ type: 'error', text: e.message });
    }
  });

  document.querySelectorAll('.script-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.script-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentActiveScript = tab.dataset.script;
      if (currentSelectedChange) {
        loadSqlScript(currentSelectedChange, currentActiveScript);
      }
    });
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetTab = document.getElementById(`tab-${btn.dataset.tab}`);
      if (targetTab) targetTab.classList.add('active');
    });
  });

  // -------------------------------------------------------------
  // TERMINAL LOG HELPER
  // -------------------------------------------------------------
  function appendTerminalLog(entry) {
    const line = document.createElement('div');
    line.className = `log-line ${entry.type || 'stdout'}`;
    line.textContent = entry.text;
    elTerminalBody.appendChild(line);
    elTerminalBody.scrollTop = elTerminalBody.scrollHeight;
  }

  elBtnClearTerminal.addEventListener('click', () => {
    elTerminalBody.innerHTML = '';
  });

  elBtnCopyTerminal.addEventListener('click', () => {
    navigator.clipboard.writeText(elTerminalBody.textContent);
    appendTerminalLog({ type: 'info', text: 'Copied console logs to clipboard.' });
  });

  // -------------------------------------------------------------
  // ACTIONS BUTTONS & HANDLERS
  // -------------------------------------------------------------
  btnDeploy.addEventListener('click', () => sendCommand('deploy'));
  btnRevert.addEventListener('click', () => sendCommand('revert'));
  btnVerify.addEventListener('click', () => sendCommand('verify'));
  btnStatus.addEventListener('click', () => sendCommand('status'));

  window.deployUpTo = function(changeName) {
    sendCommand('deploy', [changeName]);
  };

  elSearchInput.addEventListener('input', () => {
    if (currentProject) renderPlanTable(currentProject.changes);
  });

  // -------------------------------------------------------------
  // MODAL HANDLERS: ADD CHANGE
  // -------------------------------------------------------------
  btnAddChange.addEventListener('click', () => modalAddChange.classList.add('show'));
  document.getElementById('btnCloseModalAdd').addEventListener('click', () => modalAddChange.classList.remove('show'));
  document.getElementById('btnCancelModalAdd').addEventListener('click', () => modalAddChange.classList.remove('show'));

  document.getElementById('btnSubmitAddChange').addEventListener('click', async () => {
    const name = document.getElementById('newChangeName').value.trim();
    if (!name) return alert('Change name is required!');

    const rawReqs = document.getElementById('newChangeRequires').value.trim();
    const rawConf = document.getElementById('newChangeConflicts').value.trim();
    const note = document.getElementById('newChangeNote').value.trim();

    const requires = rawReqs ? rawReqs.split(',').map(s => s.trim()) : [];
    const conflicts = rawConf ? rawConf.split(',').map(s => s.trim()) : [];

    try {
      const res = await fetch('/api/change/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, requires, conflicts, note,
          mode: elModeSelect.value
        })
      });
      const data = await res.json();
      if (data.success) {
        modalAddChange.classList.remove('show');
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Created new migration change: ${name}` });
        selectChangeForEditor(name);
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // -------------------------------------------------------------
  // MODAL HANDLERS & URI BUILDER: ADD TARGET
  // -------------------------------------------------------------
  btnAddTarget.addEventListener('click', () => {
    targetEngineSelect.value = elDbEngineSelect.value;
    updateGeneratedUri();
    modalAddTarget.classList.add('show');
  });

  document.getElementById('btnCloseModalTarget').addEventListener('click', () => modalAddTarget.classList.remove('show'));
  document.getElementById('btnCancelModalTarget').addEventListener('click', () => modalAddTarget.classList.remove('show'));

  function updateGeneratedUri() {
    const eng = targetEngineSelect.value;
    const host = targetHost.value.trim() || 'localhost';
    const port = targetPort.value.trim() || (eng === 'mysql' ? '3306' : (eng === 'pg' ? '5432' : ''));
    const user = targetUser.value.trim();
    const pass = targetPass.value.trim();
    const db = targetDbName.value.trim() || 'app_db';

    let userPass = '';
    if (user) {
      userPass = pass ? `${user}:${pass}@` : `${user}@`;
    }

    let portStr = port ? `:${port}` : '';

    if (eng === 'sqlite') {
      newTargetUri.value = `db:sqlite:${db || 'sqlite.db'}`;
    } else {
      newTargetUri.value = `db:${eng}://${userPass}${host}${portStr}/${db}`;
    }
  }

  [targetEngineSelect, targetHost, targetPort, targetUser, targetPass, targetDbName].forEach(input => {
    input.addEventListener('input', updateGeneratedUri);
    input.addEventListener('change', updateGeneratedUri);
  });

  document.getElementById('btnSubmitAddTarget').addEventListener('click', async () => {
    const name = document.getElementById('newTargetName').value.trim();
    const uri = newTargetUri.value.trim();
    const engine = targetEngineSelect.value;

    if (!name || !uri) return alert('Target name and URI are required!');

    try {
      const res = await fetch('/api/target/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, uri, engine })
      });
      const data = await res.json();
      if (data.success) {
        modalAddTarget.classList.remove('show');
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Added DB Target '${name}' (${engine.toUpperCase()}): ${uri}` });
      }
    } catch (e) {
      alert(e.message);
    }
  });
});

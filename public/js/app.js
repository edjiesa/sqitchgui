document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const elCurrentPathText = document.getElementById('currentPathText');
  const elDbEngineSelect = document.getElementById('dbEngineSelect');
  const elModeSelect = document.getElementById('modeSelect');
  const elTargetSelect = document.getElementById('targetSelect');

  const elInfoProjectName = document.getElementById('infoProjectName');
  const elInfoEngine = document.getElementById('infoEngine');
  const elInfoDbStatus = document.getElementById('infoDbStatus');
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
  const btnDeleteTarget = document.getElementById('btnDeleteTarget');
  const btnTestTarget = document.getElementById('btnTestTarget');

  // Modals & Project Manager
  const modalAddChange = document.getElementById('modalAddChange');
  const modalAddTarget = document.getElementById('modalAddTarget');
  const modalProjectManager = document.getElementById('modalProjectManager');
  const btnOpenProjectManager = document.getElementById('btnOpenProjectManager');
  const btnHeaderManageProjects = document.getElementById('btnHeaderManageProjects');
  const btnSidebarManageProjects = document.getElementById('btnSidebarManageProjects');

  // Project Manager Elements
  const createProjNameInput = document.getElementById('createProjNameInput');
  const createProjEngineSelect = document.getElementById('createProjEngineSelect');
  const createProjPathPreview = document.getElementById('createProjPathPreview');
  const btnSubmitCreateProj = document.getElementById('btnSubmitCreateProj');

  const switchProjectPathInput = document.getElementById('switchProjectPathInput');
  const btnSubmitSwitchProject = document.getElementById('btnSubmitSwitchProject');
  const saveProjNameInput = document.getElementById('saveProjNameInput');
  const saveProjUriInput = document.getElementById('saveProjUriInput');
  const btnSubmitSaveProjMeta = document.getElementById('btnSubmitSaveProjMeta');

  const searchProjectsInput = document.getElementById('searchProjectsInput');
  const savedProjectsList = document.getElementById('savedProjectsList');
  const scannedRootText = document.getElementById('scannedRootText');

  // Target Builder Elements
  const targetEngineSelect = document.getElementById('targetEngineSelect');
  const newTargetName = document.getElementById('newTargetName');
  const targetHost = document.getElementById('targetHost');
  const targetPort = document.getElementById('targetPort');
  const targetUser = document.getElementById('targetUser');
  const targetPass = document.getElementById('targetPass');
  const targetDbName = document.getElementById('targetDbName');
  const newTargetUri = document.getElementById('newTargetUri');
  const modalTestResult = document.getElementById('modalTestResult');
  const btnTestModalTarget = document.getElementById('btnTestModalTarget');

  // State
  let currentProject = null;
  let currentSelectedChange = null;
  let currentActiveScript = 'deploy';
  let isUriManuallyEdited = false;
  let allProjectsList = [];
  let baseProjectRoot = '/opt/sqitchgui';
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
  // API FETCHERS & PROJECT MANAGER
  // -------------------------------------------------------------
  async function fetchEnv() {
    try {
      const res = await fetch('/api/env');
      const data = await res.json();
      if (data.success) {
        const { env, currentProjectDir, baseProjectRoot: bRoot } = data;
        elCurrentPathText.textContent = currentProjectDir;
        switchProjectPathInput.value = currentProjectDir;
        if (bRoot) {
          baseProjectRoot = bRoot;
          scannedRootText.textContent = `Root: ${bRoot}`;
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
        if (data.baseProjectRoot) {
          baseProjectRoot = data.baseProjectRoot;
          scannedRootText.textContent = `Root: ${data.baseProjectRoot}`;
        }
        renderProject(data.project);
        await fetchAllProjectsList();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchAllProjectsList() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success) {
        allProjectsList = data.projects || [];
        renderSavedProjectsList();
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Live preview for Create Project Path
  createProjNameInput.addEventListener('input', () => {
    const val = createProjNameInput.value.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    createProjPathPreview.textContent = val ? `${baseProjectRoot}/${val}` : `${baseProjectRoot}/<nama_project>`;
  });

  // Submit Create New Project
  btnSubmitCreateProj.addEventListener('click', async () => {
    const projName = createProjNameInput.value.trim();
    const engine = createProjEngineSelect.value;
    if (!projName) {
      return alert('Masukkan nama project baru!');
    }

    try {
      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projName, engine })
      });

      const data = await res.json();
      if (data.success) {
        createProjNameInput.value = '';
        elCurrentPathText.textContent = data.currentProjectDir;
        switchProjectPathInput.value = data.currentProjectDir;
        renderProject(data.project);
        await fetchAllProjectsList();
        appendTerminalLog({ type: 'success', text: `🟢 Successfully created & opened project '${projName}' at ${data.currentProjectDir}` });
        modalProjectManager.classList.remove('show');
      } else {
        alert(data.error || 'Failed to create project');
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // Open Project Manager Modal
  function openProjectManager() {
    fetchAllProjectsList();
    modalProjectManager.classList.add('show');
  }

  if (btnOpenProjectManager) btnOpenProjectManager.addEventListener('click', openProjectManager);
  if (btnHeaderManageProjects) btnHeaderManageProjects.addEventListener('click', openProjectManager);
  if (btnSidebarManageProjects) btnSidebarManageProjects.addEventListener('click', openProjectManager);

  document.getElementById('btnCloseModalProjManager').addEventListener('click', () => modalProjectManager.classList.remove('show'));
  document.getElementById('btnCancelModalProjManager').addEventListener('click', () => modalProjectManager.classList.remove('show'));

  // Switch Project Directory
  btnSubmitSwitchProject.addEventListener('click', () => {
    const targetPath = switchProjectPathInput.value.trim();
    if (!targetPath) return alert('Path is required!');
    switchProjectDirectory(targetPath);
  });

  async function switchProjectDirectory(targetPath) {
    try {
      const res = await fetch('/api/projects/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath })
      });
      const data = await res.json();
      if (data.success) {
        elCurrentPathText.textContent = data.currentProjectDir;
        switchProjectPathInput.value = data.currentProjectDir;
        renderProject(data.project);
        await fetchAllProjectsList();
        appendTerminalLog({ type: 'success', text: `Switched project directory to: ${data.currentProjectDir}` });
        modalProjectManager.classList.remove('show');
      } else {
        alert(data.error || 'Failed to switch project');
      }
    } catch (e) {
      alert(e.message);
    }
  }

  // Save Project Metadata (Name, URI)
  btnSubmitSaveProjMeta.addEventListener('click', async () => {
    const name = saveProjNameInput.value.trim();
    const uri = saveProjUriInput.value.trim();

    try {
      const res = await fetch('/api/projects/save-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, uri })
      });
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        await fetchAllProjectsList();
        appendTerminalLog({ type: 'success', text: `Saved project settings locally: Name='${name}', URI='${uri}'` });
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // Delete Saved Project from List
  window.deleteSavedProject = async function(pathToDelete) {
    if (!confirm(`Remove project path '${pathToDelete}' from saved list?`)) return;

    try {
      const res = await fetch('/api/projects/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToDelete })
      });
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        await fetchAllProjectsList();
        elCurrentPathText.textContent = data.currentProjectDir;
        switchProjectPathInput.value = data.currentProjectDir;
        appendTerminalLog({ type: 'info', text: `Removed project path '${pathToDelete}' from list.` });
      }
    } catch (e) {
      alert(e.message);
    }
  };

  window.openSavedProject = function(pathStr) {
    switchProjectDirectory(pathStr);
  };

  // Search input filter listener
  searchProjectsInput.addEventListener('input', () => {
    renderSavedProjectsList();
  });

  function renderSavedProjectsList() {
    if (!allProjectsList || allProjectsList.length === 0) {
      savedProjectsList.innerHTML = '<span class="no-tags">Belum ada project tersimpan. Buat project baru di atas.</span>';
      return;
    }

    const currentNorm = (elCurrentPathText.textContent || '').toLowerCase();
    const searchTerm = searchProjectsInput.value.trim().toLowerCase();

    const filtered = allProjectsList.filter(item => {
      const pName = (item.name || '').toLowerCase();
      const pPath = (item.path || '').toLowerCase();
      const pUri = (item.uri || '').toLowerCase();
      return pName.includes(searchTerm) || pPath.includes(searchTerm) || pUri.includes(searchTerm);
    });

    if (filtered.length === 0) {
      savedProjectsList.innerHTML = `<span class="no-tags">Tidak ditemukan project dengan nama "${searchProjectsInput.value}".</span>`;
      return;
    }

    savedProjectsList.innerHTML = filtered.map(item => {
      const pPath = item.path;
      const isActive = pPath.toLowerCase() === currentNorm;
      const cardClass = isActive ? 'project-item-card is-active' : 'project-item-card';
      const escapedPath = pPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      return `
        <div class="${cardClass}">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="ri-folder-3-fill" style="color: var(--primary);"></i>
              <strong style="color: var(--text-main); font-size: 13px;">${item.name || 'Untitled Project'}</strong>
              <span class="badge badge-engine" style="font-size:10px; padding: 1px 6px;">${(item.engine || 'PG').toUpperCase()}</span>
              ${isActive ? '<span class="badge badge-native" style="font-size:10px; padding: 1px 6px;">Active</span>' : ''}
            </div>
            <span class="proj-path-text" style="margin-left: 24px;">${pPath}</span>
          </div>
          <div class="proj-actions">
            ${!isActive ? `<button class="btn btn-primary btn-xs" onclick="window.openSavedProject('${escapedPath}')"><i class="ri-folder-open-line"></i> Buka</button>` : ''}
            <button class="btn btn-danger-outline btn-xs" onclick="window.deleteSavedProject('${escapedPath}')" title="Hapus dari daftar"><i class="ri-delete-bin-line"></i> Hapus</button>
          </div>
        </div>
      `;
    }).join('');
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

  // Delete Target Handler
  btnDeleteTarget.addEventListener('click', async () => {
    const selectedTarget = elTargetSelect.value;
    if (!selectedTarget) {
      return alert('Please select a specific Target DB from the dropdown to delete!');
    }

    if (!confirm(`Are you sure you want to delete DB target '${selectedTarget}' from sqitch.conf?`)) {
      return;
    }

    try {
      const res = await fetch('/api/target/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedTarget })
      });

      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Deleted target '${selectedTarget}' from sqitch.conf` });
      } else {
        alert(data.error || 'Failed to delete target');
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // Test Connection Button Handler
  btnTestTarget.addEventListener('click', async () => {
    const selectedTarget = elTargetSelect.value;
    elInfoDbStatus.className = 'badge badge-db-status badge-testing';
    elInfoDbStatus.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Testing...`;

    appendTerminalLog({ type: 'info', text: `Testing connection to DB Target '${selectedTarget || 'default'}'...` });

    try {
      const res = await fetch('/api/target/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: selectedTarget,
          mode: elModeSelect.value
        })
      });

      const data = await res.json();
      if (data.success) {
        elInfoDbStatus.className = 'badge badge-db-status badge-connected';
        elInfoDbStatus.innerHTML = `<i class="ri-checkbox-circle-line"></i> Connected`;
        appendTerminalLog({ type: 'success', text: `🟢 Connection SUCCESSFUL to DB Target '${selectedTarget || 'default'}'` });
      } else {
        elInfoDbStatus.className = 'badge badge-db-status badge-disconnected';
        elInfoDbStatus.innerHTML = `<i class="ri-close-circle-line"></i> Failed`;
        appendTerminalLog({ type: 'error', text: `🔴 Connection FAILED to DB Target '${selectedTarget || 'default'}'` });
      }

      if (data.output) {
        appendTerminalLog({ type: 'stdout', text: data.output });
      }
    } catch (e) {
      elInfoDbStatus.className = 'badge badge-db-status badge-disconnected';
      elInfoDbStatus.innerHTML = `<i class="ri-close-circle-line"></i> Error`;
      appendTerminalLog({ type: 'error', text: `Connection test error: ${e.message}` });
    }
  });

  // -------------------------------------------------------------
  // RENDERING LOGIC
  // -------------------------------------------------------------
  function renderProject(project) {
    currentProject = project;

    const meta = project.meta || {};
    elInfoProjectName.textContent = meta.project || 'Untitled Project';
    saveProjNameInput.value = meta.project || '';
    saveProjUriInput.value = meta.uri || '';

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
    if (config.target && typeof config.target === 'object') {
      Object.keys(config.target).forEach(tName => {
        const targetObj = config.target[tName];
        const targetUri = typeof targetObj === 'object' ? (targetObj.uri || '') : targetObj;
        const opt = document.createElement('option');
        opt.value = tName;
        opt.textContent = `${tName} (${targetUri})`;
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
    modalTestResult.style.display = 'none';
    isUriManuallyEdited = false;
    
    // Clear form inputs
    newTargetName.value = '';
    targetHost.value = '';
    targetPort.value = '';
    targetUser.value = '';
    targetPass.value = '';
    targetDbName.value = '';
    newTargetUri.value = '';

    updateGeneratedUri();
    modalAddTarget.classList.add('show');
  });

  document.getElementById('btnCloseModalTarget').addEventListener('click', () => modalAddTarget.classList.remove('show'));
  document.getElementById('btnCancelModalTarget').addEventListener('click', () => modalAddTarget.classList.remove('show'));

  newTargetUri.addEventListener('input', () => {
    isUriManuallyEdited = true;
    cleanTargetUri();
  });

  function cleanTargetUri() {
    let raw = newTargetUri.value.trim();
    const matches = raw.match(/(db:[a-z0-9]+:\/\/[^\s]+)/gi);
    if (matches && matches.length > 0) {
      newTargetUri.value = matches[matches.length - 1];
    }
  }

  function updateGeneratedUri() {
    if (isUriManuallyEdited) return;

    const eng = targetEngineSelect.value;
    const host = targetHost.value.trim() || 'localhost';
    const port = targetPort.value.trim() || (eng === 'mysql' ? '3306' : (eng === 'pg' ? '5432' : ''));
    const user = targetUser.value.trim();
    const pass = targetPass.value.trim();
    const db = targetDbName.value.trim() || 'app_db';

    // Auto fill Target Name if user typed db or host and target name is empty
    if (!newTargetName.value.trim()) {
      if (db && db !== 'app_db') {
        newTargetName.value = db;
      } else if (host && host !== 'localhost') {
        newTargetName.value = 'db_target';
      }
    }

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
    input.addEventListener('input', () => {
      isUriManuallyEdited = false;
      updateGeneratedUri();
    });
  });

  // Test Connection inside Modal
  btnTestModalTarget.addEventListener('click', async () => {
    cleanTargetUri();
    const targetUri = newTargetUri.value.trim();
    if (!targetUri) return alert('Target URI is required to test!');

    modalTestResult.style.display = 'block';
    modalTestResult.className = 'test-result-box info';
    modalTestResult.textContent = 'Testing connection to target database...';

    try {
      const res = await fetch('/api/target/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: targetUri,
          mode: elModeSelect.value
        })
      });

      const data = await res.json();
      if (data.success) {
        modalTestResult.className = 'test-result-box success';
        modalTestResult.textContent = `🟢 Connection SUCCESSFUL to database!\n${data.output || ''}`;
      } else {
        modalTestResult.className = 'test-result-box error';
        modalTestResult.textContent = `🔴 Connection FAILED to database.\n${data.output || ''}`;
      }
    } catch (e) {
      modalTestResult.className = 'test-result-box error';
      modalTestResult.textContent = `Error testing connection: ${e.message}`;
    }
  });

  document.getElementById('btnSubmitAddTarget').addEventListener('click', async () => {
    cleanTargetUri();
    let name = newTargetName.value.trim();
    const uri = newTargetUri.value.trim();
    const engine = targetEngineSelect.value;

    if (!name) {
      name = targetDbName.value.trim() || 'target_db';
    }

    if (!uri) return alert('Target URI is required!');

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
        appendTerminalLog({ type: 'success', text: `Added/Updated DB Target '${name}' (${engine.toUpperCase()}): ${uri}` });
      }
    } catch (e) {
      alert(e.message);
    }
  });
});

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

  // Editors
  const elEditorChangeName = document.getElementById('editorChangeName');
  const elSqlTextArea = document.getElementById('sqlTextArea');
  const elBtnSaveSql = document.getElementById('btnSaveSql');

  const elPlanTextArea = document.getElementById('planTextArea');
  const elBtnSaveRawPlan = document.getElementById('btnSaveRawPlan');

  // Terminal
  const elTerminalDrawer = document.getElementById('terminalDrawer');
  const elTerminalBody = document.getElementById('terminalBody');
  const elConsoleStatus = document.getElementById('consoleStatus');
  const elBtnToggleTerminal = document.getElementById('btnToggleTerminal');
  const elToggleTerminalIcon = document.getElementById('toggleTerminalIcon');
  const elBtnClearTerminal = document.getElementById('btnClearTerminal');
  const elBtnCopyTerminal = document.getElementById('btnCopyTerminal');

  // Buttons
  const btnDeploy = document.getElementById('btnDeploy');
  const btnRevert = document.getElementById('btnRevert');
  const btnVerify = document.getElementById('btnVerify');
  const btnStatus = document.getElementById('btnStatus');
  const btnAddChange = document.getElementById('btnAddChange');
  const btnAddTarget = document.getElementById('btnAddTarget');
  const btnEditTarget = document.getElementById('btnEditTarget');
  const btnDeleteTarget = document.getElementById('btnDeleteTarget');
  const btnTestTarget = document.getElementById('btnTestTarget');

  // Modals & Project Manager
  const modalAddChange = document.getElementById('modalAddChange');
  const modalAddTarget = document.getElementById('modalAddTarget');
  const modalTargetTitle = document.getElementById('modalTargetTitle');
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

  // Deploy change up to specified target (--to-change changeName)
  window.deploySingleChange = function(changeName) {
    appendTerminalLog({ type: 'info', text: `▶️ Deploying change up to '${changeName}' (--to-change ${changeName})...` });
    sendCommand('deploy', ['--to-change', changeName]);
  };

  // Toggle Enable / Disable Change in sqitch.plan (# comment)
  window.toggleChangeEnable = async function(changeName, enable) {
    const actionStr = enable ? 'Mengaktifkan' : 'Menonaktifkan (# comment)';
    appendTerminalLog({ type: 'info', text: `${actionStr} change '${changeName}' di sqitch.plan...` });

    try {
      const res = await fetch('/api/plan/toggle-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: changeName, enable })
      });
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Berhasil ${actionStr} change '${changeName}' di sqitch.plan` });
      } else {
        alert(data.error || 'Gagal mengubah status change');
      }
    } catch (e) {
      alert(e.message);
    }
  };

  // Delete Change from sqitch.plan
  window.deleteChange = async function(changeName) {
    if (!confirm(`Apakah Anda yakin ingin menghapus change '${changeName}' dari sqitch.plan?`)) {
      return;
    }

    const deleteFiles = confirm(`Apakah Anda juga ingin menghapus berkas SQL (${changeName}.sql) di folder deploy, revert, dan verify?`);

    appendTerminalLog({ type: 'info', text: `Menghapus change '${changeName}' dari sqitch.plan...` });

    try {
      const res = await fetch('/api/plan/delete-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: changeName, deleteSqlFiles: deleteFiles })
      });
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Berhasil menghapus change '${changeName}' dari sqitch.plan` });
      } else {
        alert(data.error || 'Gagal menghapus change');
      }
    } catch (e) {
      alert(e.message);
    }
  };

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

  // Raw sqitch.plan loader & saver
  async function loadRawPlanContent() {
    try {
      const res = await fetch('/api/plan');
      const data = await res.json();
      if (data.success) {
        elPlanTextArea.value = data.content || '';
      }
    } catch (e) {
      console.error(e);
    }
  }

  elBtnSaveRawPlan.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: elPlanTextArea.value })
      });
      const data = await res.json();
      if (data.success) {
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Berhasil menyimpan berkas sqitch.plan` });
        alert('Berhasil menyimpan sqitch.plan!');
      } else {
        alert(data.error || 'Gagal menyimpan sqitch.plan');
      }
    } catch (e) {
      alert(e.message);
    }
  });

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

      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (err) {
        throw new Error(`Server response error: ${resText.slice(0, 100)}`);
      }

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
      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (err) {
        throw new Error(`Server response error: ${resText.slice(0, 100)}`);
      }

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
      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (err) {
        throw new Error(`Server response error: ${resText.slice(0, 100)}`);
      }

      if (data.success) {
        renderProject(data.project);
        await fetchAllProjectsList();
        appendTerminalLog({ type: 'success', text: `Saved project settings locally: Name='${name}', URI='${uri}'` });
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // Delete Saved Project from List & Server Folder
  window.deleteSavedProject = async function(pathToDelete) {
    if (!confirm(`Hapus project '${pathToDelete}' dari daftar project?`)) return;

    const deletePhysicalFolder = confirm(`Apakah Anda juga ingin menghapus FOLDER FISIK project ini dari server (${pathToDelete})?`);

    try {
      const res = await fetch('/api/projects/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToDelete, deleteFolder: deletePhysicalFolder })
      });
      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (err) {
        throw new Error(`Server response error: ${resText.slice(0, 100)}`);
      }

      if (data.success) {
        renderProject(data.project);
        await fetchAllProjectsList();
        elCurrentPathText.textContent = data.currentProjectDir;
        switchProjectPathInput.value = data.currentProjectDir;
        appendTerminalLog({ type: 'info', text: `Berhasil menghapus project '${pathToDelete}'` });
      } else {
        alert(data.error || 'Gagal menghapus project');
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

  // Target DB URI Parser Helper
  function parseTargetUri(uri) {
    if (!uri) return {};
    let engine = 'pg';
    let host = 'localhost';
    let port = '';
    let user = '';
    let pass = '';
    let db = '';

    const mEngine = uri.match(/^db:([a-z0-9]+):/i);
    if (mEngine) engine = mEngine[1];

    let rest = uri.replace(/^db:[a-z0-9]+:\/\//i, '');
    if (rest.includes('@')) {
      const parts = rest.split('@');
      const userPass = parts[0];
      rest = parts[1];
      if (userPass.includes(':')) {
        user = userPass.split(':')[0];
        pass = userPass.split(':')[1];
      } else {
        user = userPass;
      }
    }

    if (rest.includes('/')) {
      const parts = rest.split('/');
      const hostPort = parts[0];
      db = parts.slice(1).join('/');
      if (hostPort.includes(':')) {
        host = hostPort.split(':')[0];
        port = hostPort.split(':')[1];
      } else {
        host = hostPort;
      }
    } else {
      if (rest.includes(':')) {
        host = rest.split(':')[0];
        port = rest.split(':')[1];
      } else {
        host = rest;
      }
    }

    return { engine, host, port, user, pass, db };
  }

  // Edit Target Handler
  if (btnEditTarget) {
    btnEditTarget.addEventListener('click', () => {
      const selectedTarget = elTargetSelect.value;
      if (!selectedTarget) {
        return alert('Silakan pilih Target DB yang ingin di-edit dari dropdown terlebih dahulu!');
      }

      const config = currentProject?.config || {};
      const targetObj = config.target ? config.target[selectedTarget] : null;
      const targetUri = typeof targetObj === 'object' ? (targetObj.uri || '') : (targetObj || '');

      modalTargetTitle.innerHTML = `<i class="ri-edit-line"></i> Edit Target DB Connection ('${selectedTarget}')`;
      modalTestResult.style.display = 'none';

      const parsed = parseTargetUri(targetUri);
      targetEngineSelect.value = parsed.engine || elDbEngineSelect.value;
      newTargetName.value = selectedTarget;
      targetHost.value = parsed.host || '';
      targetPort.value = parsed.port || '';
      targetUser.value = parsed.user || '';
      targetPass.value = parsed.pass || '';
      targetDbName.value = parsed.db || '';
      newTargetUri.value = targetUri;

      isUriManuallyEdited = true;
      modalAddTarget.classList.add('show');
    });
  }

  // Delete Target Handler
  btnDeleteTarget.addEventListener('click', async () => {
    const selectedTarget = elTargetSelect.value;
    if (!selectedTarget) {
      return alert('Silakan pilih Target DB yang ingin dihapus dari dropdown terlebih dahulu!');
    }

    if (!confirm(`Apakah Anda yakin ingin menghapus Target DB '${selectedTarget}' secara permanen?`)) {
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
        appendTerminalLog({ type: 'success', text: `Berhasil menghapus target '${selectedTarget}'` });
      } else {
        alert(data.error || 'Gagal menghapus target');
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
  function renderProject(project, selectTargetName = null) {
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

    // Remember currently selected target
    const prevSelectedTarget = selectTargetName || elTargetSelect.value;

    // Render Targets Dropdown
    elTargetSelect.innerHTML = '<option value="">Default Target</option>';
    if (config.target && typeof config.target === 'object') {
      Object.keys(config.target).forEach(tName => {
        const targetObj = config.target[tName];
        const targetUri = typeof targetObj === 'object' ? (targetObj.uri || '') : targetObj;
        const opt = document.createElement('option');
        opt.value = tName;
        opt.textContent = targetUri ? `${tName} (${targetUri})` : tName;
        elTargetSelect.appendChild(opt);
      });
    }

    // Restore selected target if available in dropdown
    if (prevSelectedTarget && Array.from(elTargetSelect.options).some(o => o.value === prevSelectedTarget)) {
      elTargetSelect.value = prevSelectedTarget;
    } else if (elTargetSelect.options.length > 1) {
      elTargetSelect.selectedIndex = 1;
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
    const activeChanges = changes.filter(c => !c.disabled);
    if (activeChanges.length > 0 && !currentSelectedChange) {
      selectChangeForEditor(activeChanges[0].name);
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
      const isDisabled = item.disabled;
      const rowClass = isDisabled ? 'is-disabled' : (isTag ? 'is-tag' : '');

      const reqsHtml = item.requires && item.requires.length > 0
        ? item.requires.map(r => `<span class="req-tag">${r}</span>`).join('')
        : '<span style="color: var(--text-dim);">-</span>';

      const plannerDate = item.timestamp
        ? `${item.planner || 'Dev'} (${item.timestamp.split('T')[0]})`
        : (isDisabled ? 'Nonaktif (#)' : '-');

      const typeBadge = isDisabled
        ? '<span class="badge" style="background: rgba(239,68,68,0.2); color: var(--danger); padding: 2px 6px; border-radius: 4px; font-size:11px;"><i class="ri-eye-off-line"></i> DISABLED</span>'
        : (isTag
            ? '<span class="badge" style="background: rgba(245,158,11,0.2); color: var(--warning); padding: 2px 6px; border-radius: 4px; font-size:11px;">TAG</span>'
            : '<span class="badge" style="background: rgba(56,189,248,0.2); color: var(--primary); padding: 2px 6px; border-radius: 4px; font-size:11px;">CHANGE</span>');

      return `
        <tr class="${rowClass}" style="${isDisabled ? 'opacity: 0.5; background: rgba(255,255,255,0.02);' : ''}">
          <td><strong>${idx + 1}</strong></td>
          <td>${typeBadge}</td>
          <td>
            <span class="change-name" style="cursor: pointer; ${isDisabled ? 'text-decoration: line-through;' : ''}" onclick="window.selectChange('${item.name}')">
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
              ${isDisabled
                ? `<button class="btn btn-success btn-xs" onclick="window.toggleChangeEnable('${item.name}', true)" title="Aktifkan kembali change ini di sqitch.plan">
                     <i class="ri-eye-line"></i> Aktifkan
                   </button>`
                : `<button class="btn btn-warning-outline btn-xs" onclick="window.toggleChangeEnable('${item.name}', false)" title="Nonaktifkan change ini (# comment) di sqitch.plan">
                     <i class="ri-eye-off-line"></i> Nonaktif
                   </button>
                   <button class="btn btn-success btn-xs" onclick="window.deploySingleChange('${item.name}')" title="Jalankan change ini (sqitch deploy --to-change ${item.name})">
                     <i class="ri-play-line"></i>
                   </button>`}
              <button class="btn btn-danger-outline btn-xs" onclick="window.deleteChange('${item.name}')" title="Hapus change ini dari sqitch.plan">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // -------------------------------------------------------------
  // SQL & PLAN EDITOR LOGIC
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
      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (err) {
        throw new Error(`Server error: ${resText.slice(0, 100)}`);
      }

      if (data.success) {
        elSqlTextArea.value = data.files[scriptType] || `-- No ${scriptType}.sql content found for ${changeName}`;
      }
    } catch (e) {
      console.error(e);
    }
  }

  elBtnSaveSql.addEventListener('click', async () => {
    if (!currentSelectedChange) return alert('Pilih change terlebih dahulu di Plan Timeline!');

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

      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (jsonErr) {
        throw new Error(`Server error: ${resText.slice(0, 100)}`);
      }

      if (data.success) {
        appendTerminalLog({ type: 'success', text: `Successfully saved ${currentActiveScript}/${currentSelectedChange}.sql` });
        alert(`Berhasil menyimpan ${currentActiveScript}/${currentSelectedChange}.sql`);
      } else {
        alert(data.error || 'Failed to save SQL file');
      }
    } catch (e) {
      appendTerminalLog({ type: 'error', text: e.message });
      alert(e.message);
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

      if (btn.dataset.tab === 'plan-editor') {
        loadRawPlanContent();
      }
    });
  });

  // -------------------------------------------------------------
  // TERMINAL LOG HELPER & MINIMIZE TOGGLE
  // -------------------------------------------------------------
  function appendTerminalLog(entry) {
    const line = document.createElement('div');
    line.className = `log-line ${entry.type || 'stdout'}`;
    line.textContent = entry.text;
    elTerminalBody.appendChild(line);
    elTerminalBody.scrollTop = elTerminalBody.scrollHeight;
  }

  if (elBtnToggleTerminal) {
    elBtnToggleTerminal.addEventListener('click', () => {
      elTerminalDrawer.classList.toggle('minimized');
      if (elTerminalDrawer.classList.contains('minimized')) {
        elToggleTerminalIcon.className = 'ri-add-line';
        elBtnToggleTerminal.title = 'Expand Console';
      } else {
        elToggleTerminalIcon.className = 'ri-subtract-line';
        elBtnToggleTerminal.title = 'Minimize Console';
      }
    });
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

      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (jsonErr) {
        throw new Error(`Server error: ${resText.slice(0, 100)}`);
      }

      if (data.success) {
        modalAddChange.classList.remove('show');
        renderProject(data.project);
        appendTerminalLog({ type: 'success', text: `Created new migration change: ${name}` });
        selectChangeForEditor(name);
      } else {
        alert(data.error || 'Failed to create change');
      }
    } catch (e) {
      alert(e.message);
    }
  });

  // -------------------------------------------------------------
  // MODAL HANDLERS & URI BUILDER: ADD / EDIT TARGET
  // -------------------------------------------------------------
  btnAddTarget.addEventListener('click', () => {
    modalTargetTitle.innerHTML = `<i class="ri-database-2-line"></i> Add Database Target Connection`;
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
        renderProject(data.project, data.addedTarget || name);
        appendTerminalLog({ type: 'success', text: `Added/Updated DB Target '${name}' (${engine.toUpperCase()}): ${uri}` });
      }
    } catch (e) {
      alert(e.message);
    }
  });
});

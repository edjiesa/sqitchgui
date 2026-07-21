const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const SqitchPlanParser = require('./lib/sqitch-parser');
const SqitchRunner = require('./lib/sqitch-runner');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
let currentProjectDir = process.cwd();

// Default root directory for storing projects (/opt/sqitchgui or C:\opt\sqitchgui)
const BASE_PROJECT_ROOT = process.platform === 'win32' ? 'C:\\opt\\sqitchgui' : '/opt/sqitchgui';

// Saved projects storage file
const PROJECTS_STORE = path.join(__dirname, 'saved_projects.json');

function getProjectRootDir() {
  if (fs.existsSync('/opt/sqitchgui')) return '/opt/sqitchgui';
  if (fs.existsSync('C:\\opt\\sqitchgui')) return 'C:\\opt\\sqitchgui';
  return BASE_PROJECT_ROOT;
}

function scanProjectsInRootDir(rootDir) {
  const discovered = [];
  try {
    if (fs.existsSync(rootDir)) {
      const items = fs.readdirSync(rootDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const fullPath = path.join(rootDir, item.name);
          if (fs.existsSync(path.join(fullPath, 'sqitch.plan'))) {
            discovered.push(fullPath);
          }
        }
      }
    }
  } catch (e) {
    console.error('Scan root dir error:', e);
  }
  return discovered;
}

function getSavedProjects() {
  let list = [];
  if (fs.existsSync(PROJECTS_STORE)) {
    try {
      list = JSON.parse(fs.readFileSync(PROJECTS_STORE, 'utf8'));
    } catch (e) {
      list = [currentProjectDir];
    }
  } else {
    list = [currentProjectDir];
  }

  // Combine with auto-scanned projects in /opt/sqitchgui
  const rootDir = getProjectRootDir();
  const scanned = scanProjectsInRootDir(rootDir);
  const combined = Array.from(new Set([...list, ...scanned, currentProjectDir]));

  return combined;
}

function saveSavedProjects(list) {
  try {
    const uniqueList = Array.from(new Set(list));
    fs.writeFileSync(PROJECTS_STORE, JSON.stringify(uniqueList, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save projects list:', e);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure empty project file exists if current project has no plan
const runnerHelper = new SqitchRunner();
if (!fs.existsSync(path.join(currentProjectDir, 'sqitch.plan'))) {
  runnerHelper.initEmptyProjectFiles(currentProjectDir, 'sqitchgui', 'pg');
}
saveSavedProjects(getSavedProjects());

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// Environment check
app.get('/api/env', (req, res) => {
  const envInfo = SqitchRunner.detectEnvironment();
  res.json({
    success: true,
    env: envInfo,
    currentProjectDir,
    baseProjectRoot: getProjectRootDir()
  });
});

// Get project details, saved projects, and metadata directly from sqitch.plan inside the active project directory
app.get('/api/project', (req, res) => {
  try {
    const projectData = SqitchPlanParser.parseProject(currentProjectDir);
    const savedProjects = getSavedProjects();
    res.json({
      success: true,
      project: projectData,
      savedProjects,
      baseProjectRoot: getProjectRootDir()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get saved and scanned projects list with names
app.get('/api/projects', (req, res) => {
  const list = getSavedProjects();
  const projectSummaries = list.map(pPath => {
    try {
      const pData = SqitchPlanParser.parseProject(pPath);
      return {
        path: pPath,
        name: pData.meta.project || path.basename(pPath),
        engine: pData.config?.core?.engine || 'pg',
        uri: pData.meta.uri || ''
      };
    } catch (e) {
      return {
        path: pPath,
        name: path.basename(pPath),
        engine: 'pg',
        uri: ''
      };
    }
  });

  res.json({
    success: true,
    projects: projectSummaries,
    currentProjectDir,
    baseProjectRoot: getProjectRootDir()
  });
});

// Create New Project in /opt/sqitchgui/<projectName> with a clean empty sqitch.plan
app.post('/api/projects/create', (req, res) => {
  const { name, engine = 'pg' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Project name is required' });
  }

  const cleanName = name.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  const rootDir = getProjectRootDir();
  
  // Ensure root directory exists
  if (!fs.existsSync(rootDir)) {
    try {
      fs.mkdirSync(rootDir, { recursive: true });
    } catch (e) {
      console.warn(`Could not create root dir ${rootDir}:`, e.message);
    }
  }

  const targetProjDir = path.join(rootDir, cleanName);
  if (!fs.existsSync(targetProjDir)) {
    fs.mkdirSync(targetProjDir, { recursive: true });
  }

  // Initialize clean empty project files in /opt/sqitchgui/<cleanName>
  runnerHelper.initEmptyProjectFiles(targetProjDir, cleanName, engine);

  currentProjectDir = targetProjDir;

  const list = getSavedProjects();
  if (!list.includes(targetProjDir)) {
    list.unshift(targetProjDir);
    saveSavedProjects(list);
  }

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({
    success: true,
    project: projectData,
    savedProjects: list,
    currentProjectDir,
    message: `Created project '${cleanName}' at ${targetProjDir}`
  });
});

// Switch working project directory
app.post('/api/projects/switch', (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath || !fs.existsSync(newPath)) {
    return res.status(400).json({ success: false, error: `Directory does not exist: ${newPath}` });
  }

  currentProjectDir = path.resolve(newPath);

  // Initialize empty project files ONLY if sqitch.plan is missing in the chosen directory
  if (!fs.existsSync(path.join(currentProjectDir, 'sqitch.plan'))) {
    const defaultName = path.basename(currentProjectDir) || 'app_db';
    runnerHelper.initEmptyProjectFiles(currentProjectDir, defaultName, 'pg');
  }

  // Update saved list
  const list = getSavedProjects();
  if (!list.includes(currentProjectDir)) {
    list.unshift(currentProjectDir);
    saveSavedProjects(list);
  }

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData, savedProjects: list, currentProjectDir });
});

// Delete/Remove project from saved projects list
app.post('/api/projects/delete', (req, res) => {
  const { path: targetPath } = req.body;
  if (!targetPath) return res.status(400).json({ success: false, error: 'Path is required' });

  let list = getSavedProjects();
  list = list.filter(p => path.resolve(p) !== path.resolve(targetPath));
  saveSavedProjects(list);

  // If deleted current project, switch to first available or cwd
  if (path.resolve(currentProjectDir) === path.resolve(targetPath)) {
    currentProjectDir = list.length > 0 ? list[0] : process.cwd();
  }

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData, savedProjects: list, currentProjectDir });
});

// Save Project Meta (Name, URI) in sqitch.plan AND sqitch.conf locally inside project directory (/repo in Docker)
app.post('/api/projects/save-meta', (req, res) => {
  const { name, uri } = req.body;
  const planPath = path.join(currentProjectDir, 'sqitch.plan');
  const confPath = path.join(currentProjectDir, 'sqitch.conf');

  // 1. Save to sqitch.plan (%project=, %uri=)
  if (fs.existsSync(planPath)) {
    let planContent = fs.readFileSync(planPath, 'utf8');

    if (name) {
      if (planContent.includes('%project=')) {
        planContent = planContent.replace(/%project=.*(\r?\n)/, `%project=${name}$1`);
      } else {
        planContent = `%project=${name}\n` + planContent;
      }
    }

    if (uri) {
      if (planContent.includes('%uri=')) {
        planContent = planContent.replace(/%uri=.*(\r?\n)/, `%uri=${uri}$1`);
      } else {
        planContent = `%uri=${uri}\n` + planContent;
      }
    }

    fs.writeFileSync(planPath, planContent, 'utf8');
  }

  // 2. Save to sqitch.conf ([core] uri =, [core] project =) locally
  let confContent = fs.existsSync(confPath) ? fs.readFileSync(confPath, 'utf8') : '[core]\n  engine = pg\n';

  if (uri) {
    if (confContent.includes('uri =')) {
      confContent = confContent.replace(/uri\s*=\s*.*(\r?\n)/, `uri = ${uri}$1`);
    } else {
      confContent = confContent.replace('[core]', `[core]\n  uri = ${uri}`);
    }
  }

  if (name) {
    if (confContent.includes('project =')) {
      confContent = confContent.replace(/project\s*=\s*.*(\r?\n)/, `project = ${name}$1`);
    } else {
      confContent = confContent.replace('[core]', `[core]\n  project = ${name}`);
    }
  }

  fs.writeFileSync(confPath, confContent, 'utf8');

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData });
});

// Initialize new sqitch project
app.post('/api/project/init', (req, res) => {
  const { name = 'app_db', engine = 'pg' } = req.body;
  runnerHelper.initEmptyProjectFiles(currentProjectDir, name, engine);
  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData });
});

// Set active database engine
app.post('/api/engine/set', (req, res) => {
  const { engine } = req.body;
  if (!engine) return res.status(400).json({ success: false, error: 'Engine name is required' });

  const confPath = path.join(currentProjectDir, 'sqitch.conf');
  let content = fs.existsSync(confPath) ? fs.readFileSync(confPath, 'utf8') : '[core]\n';

  if (content.includes('engine =')) {
    content = content.replace(/engine\s*=\s*[a-zA-Z0-9_\-]+/g, `engine = ${engine}`);
  } else {
    content = content.replace('[core]', `[core]\n  engine = ${engine}`);
  }

  fs.writeFileSync(confPath, content, 'utf8');

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData });
});

// Read SQL script files for a change
app.get('/api/change/files', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ success: false, error: 'Change name required' });

  const files = {
    deploy: '',
    revert: '',
    verify: ''
  };

  ['deploy', 'revert', 'verify'].forEach(type => {
    const filePath = path.join(currentProjectDir, type, `${name}.sql`);
    if (fs.existsSync(filePath)) {
      files[type] = fs.readFileSync(filePath, 'utf8');
    }
  });

  res.json({ success: true, name, files });
});

// Save SQL script file for a change
app.post('/api/change/files', (req, res) => {
  const { name, type, content } = req.body;
  if (!name || !type || !['deploy', 'revert', 'verify'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid parameters.' });
  }

  const dirPath = path.join(currentProjectDir, type);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

  const filePath = path.join(dirPath, `${name}.sql`);
  fs.writeFileSync(filePath, content, 'utf8');

  res.json({ success: true, message: `Updated ${type}/${name}.sql` });
});

// Add new change
app.post('/api/change/add', (req, res) => {
  const { name, requires = [], conflicts = [], note = '', mode = 'auto' } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Change name is required' });

  const args = [name];
  requires.forEach(r => args.push(`-r=${r}`));
  conflicts.forEach(c => args.push(`-c=${c}`));
  if (note) args.push(`-n=${note}`);

  const runner = new SqitchRunner({ mode });
  runner.on('done', () => {
    const projectData = SqitchPlanParser.parseProject(currentProjectDir);
    res.json({ success: true, project: projectData });
  });

  runner.run('add', args, currentProjectDir);
});

// Add or Update target in sqitch.conf
app.post('/api/target/add', (req, res) => {
  const { name, uri, engine } = req.body;
  if (!name || !uri) return res.status(400).json({ success: false, error: 'Target name and URI are required' });

  const confPath = path.join(currentProjectDir, 'sqitch.conf');
  let content = fs.existsSync(confPath) ? fs.readFileSync(confPath, 'utf8') : '[core]\n  engine = pg\n';

  // Parse sections and remove old target section with same name if it exists
  const lines = content.split(/\r?\n/);
  const newLines = [];
  let inTargetSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const tMatch = trimmed.match(/^\[\s*target\s+(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*\]$/i);
      if (tMatch) {
        const foundName = tMatch[1] || tMatch[2] || tMatch[3];
        if (foundName === name) {
          inTargetSection = true;
          continue;
        }
      }
      inTargetSection = false;
    }

    if (!inTargetSection) {
      newLines.push(line);
    }
  }

  let cleanContent = newLines.join('\n').trim();

  // Add target section
  cleanContent += `\n\n[target "${name}"]\n  uri = ${uri}\n`;

  // Update or set engine target
  const activeEng = engine || 'pg';
  if (cleanContent.includes(`[engine "${activeEng}"]`)) {
    if (cleanContent.match(new RegExp(`\\[engine "${activeEng}"\\][^\\[]*target\\s*=`, 'i'))) {
      cleanContent = cleanContent.replace(
        new RegExp(`(\\[engine "${activeEng}"\\][^\\[]*?)target\\s*=\\s*.*`, 'i'),
        `$1target = ${name}`
      );
    } else {
      cleanContent = cleanContent.replace(
        `[engine "${activeEng}"]`,
        `[engine "${activeEng}"]\n  target = ${name}`
      );
    }
  } else {
    cleanContent += `\n[engine "${activeEng}"]\n  target = ${name}\n`;
  }

  fs.writeFileSync(confPath, cleanContent, 'utf8');

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData, addedTarget: name });
});

// Delete database target from sqitch.conf
app.post('/api/target/delete', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Target name is required' });

  const confPath = path.join(currentProjectDir, 'sqitch.conf');
  if (!fs.existsSync(confPath)) {
    return res.status(400).json({ success: false, error: 'sqitch.conf file not found' });
  }

  let content = fs.readFileSync(confPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const newLines = [];
  let inTargetSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const tMatch = trimmed.match(/^\[\s*target\s+(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*\]$/i);
      if (tMatch) {
        const foundName = tMatch[1] || tMatch[2] || tMatch[3];
        if (foundName === name) {
          inTargetSection = true;
          continue;
        }
      }
      inTargetSection = false;
    }

    if (!inTargetSection) {
      newLines.push(line);
    }
  }

  fs.writeFileSync(confPath, newLines.join('\n'), 'utf8');

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, message: `Target '${name}' deleted successfully`, project: projectData });
});

// Test Database Connection Endpoint
app.post('/api/target/test', (req, res) => {
  const { target, mode = 'auto' } = req.body;
  const runner = new SqitchRunner({ mode, target });

  let outputText = '';

  runner.on('log', (logEntry) => {
    outputText += `${logEntry.text}\n`;
  });

  runner.on('done', (result) => {
    const isConnected = outputText.includes('# On database') || 
                        outputText.includes('No changes deployed') || 
                        outputText.includes('Nothing to deploy') || 
                        result.success;

    res.json({
      success: isConnected,
      target: target || 'default',
      output: outputText,
      statusMessage: isConnected ? 'Database connection successful!' : 'Database connection failed.'
    });
  });

  runner.run('status', [], currentProjectDir);
});

// -------------------------------------------------------------
// WEBSOCKET LOG STREAMING
// -------------------------------------------------------------
wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const { action, target, mode = 'auto', extraArgs = [] } = data;

      if (!action) return;

      const runner = new SqitchRunner({ mode, target });

      runner.on('log', (logEntry) => {
        ws.send(JSON.stringify({ type: 'log', data: logEntry }));
      });

      runner.on('done', (result) => {
        const projectData = SqitchPlanParser.parseProject(currentProjectDir);
        ws.send(JSON.stringify({ type: 'done', data: result, project: projectData }));
      });

      runner.run(action, extraArgs, currentProjectDir);

    } catch (err) {
      ws.send(JSON.stringify({ type: 'log', data: { type: 'error', text: err.message } }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  Sqitch Studio GUI is running on http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure demo project exists if project is empty
const runnerHelper = new SqitchRunner();
if (!fs.existsSync(path.join(currentProjectDir, 'sqitch.plan'))) {
  runnerHelper.initDemoProjectFiles(currentProjectDir, 'sqitch_demo_db', 'pg');
}

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// Environment check
app.get('/api/env', (req, res) => {
  const envInfo = SqitchRunner.detectEnvironment();
  res.json({
    success: true,
    env: envInfo,
    currentProjectDir
  });
});

// Get project details and plan
app.get('/api/project', (req, res) => {
  try {
    const projectData = SqitchPlanParser.parseProject(currentProjectDir);
    res.json({ success: true, project: projectData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Change project directory
app.post('/api/project/path', (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath || !fs.existsSync(newPath)) {
    return res.status(400).json({ success: false, error: 'Invalid directory path.' });
  }

  currentProjectDir = path.resolve(newPath);
  if (!fs.existsSync(path.join(currentProjectDir, 'sqitch.plan'))) {
    runnerHelper.initDemoProjectFiles(currentProjectDir, 'app_db', 'pg');
  }

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData });
});

// Initialize new sqitch project
app.post('/api/project/init', (req, res) => {
  const { name = 'app_db', engine = 'pg' } = req.body;
  runnerHelper.initDemoProjectFiles(currentProjectDir, name, engine);
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

// Add new target or engine connection
app.post('/api/target/add', (req, res) => {
  const { name, uri, engine } = req.body;
  if (!name || !uri) return res.status(400).json({ success: false, error: 'Target name and URI are required' });

  const confPath = path.join(currentProjectDir, 'sqitch.conf');
  let targetBlock = `\n[target "${name}"]\n  uri = ${uri}\n`;

  if (engine) {
    targetBlock += `\n[engine "${engine}"]\n  target = ${name}\n`;
  }

  fs.appendFileSync(confPath, targetBlock, 'utf8');

  const projectData = SqitchPlanParser.parseProject(currentProjectDir);
  res.json({ success: true, project: projectData });
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
      if (trimmed === `[target "${name}"]` || trimmed === `[target '${name}']`) {
        inTargetSection = true;
        continue;
      } else {
        inTargetSection = false;
      }
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

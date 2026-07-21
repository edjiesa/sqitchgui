const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class SqitchRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'auto'; // 'native', 'docker', 'simulated', 'auto'
    this.customPath = options.customPath || 'sqitch';
    this.target = (options.target || '').trim();
  }

  /**
   * Check available Sqitch runtimes
   */
  static detectEnvironment() {
    let nativeAvailable = false;
    let nativeVersion = '';
    let dockerAvailable = false;
    let dockerVersion = '';

    // Test native sqitch
    try {
      const out = execSync('sqitch --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      nativeAvailable = true;
      nativeVersion = out.trim();
    } catch (e) {
      nativeAvailable = false;
    }

    // Test docker
    try {
      const out = execSync('docker --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      dockerAvailable = true;
      dockerVersion = out.trim();
    } catch (e) {
      dockerAvailable = false;
    }

    return {
      nativeAvailable,
      nativeVersion,
      dockerAvailable,
      dockerVersion,
      recommendedMode: nativeAvailable ? 'native' : (dockerAvailable ? 'docker' : 'simulated')
    };
  }

  /**
   * Execute a Sqitch command
   * @param {string} command Command name: status, deploy, revert, verify, add, log, init
   * @param {Array<string>} args Additional command line arguments
   * @param {string} projectDir Working directory of Sqitch project
   */
  run(command, args = [], projectDir = process.cwd()) {
    const env = SqitchRunner.detectEnvironment();
    let activeMode = this.mode;
    if (activeMode === 'auto') {
      activeMode = env.recommendedMode;
    }

    this.emit('log', { type: 'info', text: `Executing sqitch ${command} [Mode: ${activeMode.toUpperCase()}]` });

    if (activeMode === 'simulated') {
      return this.runSimulated(command, args, projectDir);
    } else if (activeMode === 'docker') {
      return this.runDocker(command, args, projectDir);
    } else {
      return this.runNative(command, args, projectDir);
    }
  }

  runNative(command, args, projectDir) {
    const fullArgs = [command, ...args];
    if (this.target && command !== 'init' && command !== 'add') {
      const quotedTarget = this.target.includes(' ') && !this.target.startsWith('"') ? `"${this.target}"` : this.target;
      fullArgs.push('--target', quotedTarget);
    }

    this.emit('log', { type: 'cmd', text: `$ ${this.customPath} ${fullArgs.join(' ')}` });

    const proc = spawn(this.customPath, fullArgs, {
      cwd: projectDir,
      env: process.env,
      shell: true
    });

    let fullOutput = '';

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      fullOutput += str;
      this.emit('log', { type: 'stdout', text: str });
    });

    proc.stderr.on('data', (data) => {
      const errText = data.toString();
      fullOutput += errText;
      this.emit('log', { type: 'stderr', text: errText });

      if (errText.includes('Cannot find target')) {
        const match = errText.match(/Cannot find target "([^"]+)"/);
        const targetName = match ? match[1] : (this.target || '');
        this.emit('log', {
          type: 'warning',
          text: `\n💡 Tip: Target "${targetName}" is not defined in sqitch.conf.\n   Click "+ Add DB Target" in the top bar to register [target "${targetName}"] with a valid database URI.`
        });
      }
    });

    proc.on('close', (code) => {
      const isConnectionOk = code === 0 || fullOutput.includes('# On database') || fullOutput.includes('No changes deployed');

      if (isConnectionOk) {
        this.emit('log', { type: 'success', text: `Command 'sqitch ${command}' completed.` });
        this.emit('done', { success: true, code });
      } else {
        this.emit('log', { type: 'error', text: `Command 'sqitch ${command}' failed with exit code ${code}.` });
        this.emit('done', { success: false, code });
      }
    });

    return proc;
  }

  runDocker(command, args, projectDir) {
    const normalizedDir = path.resolve(projectDir).replace(/\\/g, '/');
    let targetVal = this.target;

    // Convert localhost to host.docker.internal for Docker networking if target contains localhost
    if (targetVal && (targetVal.includes('localhost') || targetVal.includes('127.0.0.1'))) {
      this.emit('log', { type: 'info', text: 'Notice: Converting localhost to host.docker.internal for Docker container network access...' });
      targetVal = targetVal.replace(/localhost/g, 'host.docker.internal').replace(/127\.0\.0\.1/g, 'host.docker.internal');
    }

    const dockerArgs = [
      'run', '--rm',
      '-v', `${normalizedDir}:/repo`,
      '-w', '/repo',
      'sqitch/sqitch:latest',
      command,
      ...args
    ];

    if (targetVal && command !== 'init' && command !== 'add') {
      const quotedTarget = targetVal.includes(' ') && !targetVal.startsWith('"') ? `"${targetVal}"` : targetVal;
      dockerArgs.push('--target', quotedTarget);
    }

    this.emit('log', { type: 'cmd', text: `$ docker ${dockerArgs.join(' ')}` });

    const proc = spawn('docker', dockerArgs, {
      cwd: projectDir,
      env: process.env,
      shell: true
    });

    let fullOutput = '';

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      fullOutput += str;
      this.emit('log', { type: 'stdout', text: str });
    });

    proc.stderr.on('data', (data) => {
      const errText = data.toString();
      fullOutput += errText;
      this.emit('log', { type: 'stderr', text: errText });

      if (errText.includes('Cannot find target')) {
        const match = errText.match(/Cannot find target "([^"]+)"/);
        const targetName = match ? match[1] : (targetVal || '');
        this.emit('log', {
          type: 'warning',
          text: `\n💡 Tip: Target "${targetName}" is not defined in sqitch.conf inside ${normalizedDir}.\n   Click "+ Add DB Target" in the top bar to add [target "${targetName}"] with your database connection URI.`
        });
      }
    });

    proc.on('close', (code) => {
      const isConnectionOk = code === 0 || fullOutput.includes('# On database') || fullOutput.includes('No changes deployed');

      if (isConnectionOk) {
        this.emit('log', { type: 'success', text: `Docker Sqitch '${command}' completed.` });
        this.emit('done', { success: true, code });
      } else {
        this.emit('log', { type: 'error', text: `Docker Sqitch '${command}' failed with exit code ${code}.` });
        this.emit('done', { success: false, code });
      }
    });

    return proc;
  }

  runSimulated(command, args, projectDir) {
    const steps = [];

    this.emit('log', { type: 'cmd', text: `$ sqitch ${command} ${args.join(' ')} (Simulated Mode)` });

    if (command === 'init') {
      const projName = args[0] || 'app_db';
      const engine = args.find(a => a.startsWith('--engine'))?.split('=')[1] || 'pg';
      steps.push(
        { text: `Created sqitch.plan`, delay: 300 },
        { text: `Created sqitch.conf with engine '${engine}'`, delay: 300 },
        { text: `Created deploy/, revert/, verify/ directories`, delay: 300 },
        { text: `Initialized Sqitch project '${projName}'`, delay: 200 }
      );
      this.initDemoProjectFiles(projectDir, projName, engine);
    } else if (command === 'status') {
      steps.push(
        { text: `# On database ${this.target || 'db:pg://postgres:postgres@localhost:5432/app_db'}`, delay: 200 },
        { text: `# Project:  app_db`, delay: 150 },
        { text: `# Change:   app_schema`, delay: 200 },
        { text: `# Status:   Deployed`, delay: 150 },
        { text: `Nothing to deploy (working tree clean)`, delay: 200 }
      );
    } else if (command === 'deploy') {
      steps.push(
        { text: `Deploying changes to ${this.target || 'db:pg://postgres:postgres@localhost:5432/app_db'}`, delay: 200 },
        { text: `+ app_schema .. ok`, delay: 400 },
        { text: `+ users_table .. ok`, delay: 500 },
        { text: `+ add_user_roles [users_table] .. ok`, delay: 450 },
        { text: `@v1.0.0 .. ok`, delay: 200 },
        { text: `+ audit_logs .. ok`, delay: 400 },
        { text: `Ok: All changes deployed successfully.`, delay: 200 }
      );
    } else if (command === 'revert') {
      steps.push(
        { text: `Reverting changes from ${this.target || 'db:pg://postgres:postgres@localhost:5432/app_db'}`, delay: 200 },
        { text: `- audit_logs .. ok`, delay: 400 },
        { text: `- add_user_roles .. ok`, delay: 450 },
        { text: `Reverted to change 'users_table'.`, delay: 200 }
      );
    } else if (command === 'verify') {
      steps.push(
        { text: `Verifying database changes on ${this.target || 'default target'}...`, delay: 200 },
        { text: `* app_schema .. ok`, delay: 300 },
        { text: `* users_table .. ok`, delay: 300 },
        { text: `* add_user_roles .. ok`, delay: 300 },
        { text: `* audit_logs .. ok`, delay: 300 },
        { text: `Verification successful: 4/4 changes verified.`, delay: 200 }
      );
    } else if (command === 'add') {
      const changeName = args[0] || 'new_feature';
      steps.push(
        { text: `Added "${changeName}" to sqitch.plan`, delay: 200 },
        { text: `+ deploy/${changeName}.sql`, delay: 250 },
        { text: `+ revert/${changeName}.sql`, delay: 250 },
        { text: `+ verify/${changeName}.sql`, delay: 250 }
      );
      this.addDemoChangeFiles(projectDir, changeName, args);
    } else {
      steps.push({ text: `Sqitch ${command} execution complete.`, delay: 300 });
    }

    let i = 0;
    const runNextStep = () => {
      if (i < steps.length) {
        const step = steps[i++];
        this.emit('log', { type: 'stdout', text: step.text });
        setTimeout(runNextStep, step.delay);
      } else {
        this.emit('log', { type: 'success', text: `Simulated Sqitch '${command}' complete.` });
        this.emit('done', { success: true, code: 0 });
      }
    };

    setTimeout(runNextStep, 200);
    return null;
  }

  initDemoProjectFiles(projectDir, projName = 'app_db', engine = 'pg') {
    const planContent = `%syntax-version=1.0.0
%project=${projName}
%uri=https://github.com/user/${projName}

# Database initial schema setup
app_schema 2026-07-21T02:00:00Z Sqitch Developer <dev@example.com> # Create application schema

# User authentication tables
users_table [app_schema] 2026-07-21T02:10:00Z Sqitch Developer <dev@example.com> # Create users and credentials table

# User roles & permissions
add_user_roles [users_table] 2026-07-21T02:20:00Z Sqitch Developer <dev@example.com> # Add role enum and roles table

@v1.0.0 2026-07-21T02:30:00Z Sqitch Developer <dev@example.com> # Release version 1.0.0

# Audit logging
audit_logs [users_table] 2026-07-21T02:40:00Z Sqitch Developer <dev@example.com> # Create audit logs table and trigger
`;

    const confContent = `[core]
  engine = ${engine}
  top_dir = .
  plan_file = sqitch.plan

[engine "${engine}"]
  target = db:${engine}://postgres:postgres@localhost:5432/${projName}

[target "dev"]
  uri = db:${engine}://postgres:postgres@localhost:5432/${projName}
`;

    fs.writeFileSync(path.join(projectDir, 'sqitch.plan'), planContent, 'utf8');
    fs.writeFileSync(path.join(projectDir, 'sqitch.conf'), confContent, 'utf8');

    const dirs = ['deploy', 'revert', 'verify'];
    dirs.forEach(d => {
      const dirPath = path.join(projectDir, d);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    });

    fs.writeFileSync(path.join(projectDir, 'deploy/app_schema.sql'), `-- Deploy ${projName}:app_schema to ${engine}\n\nBEGIN;\nCREATE SCHEMA IF NOT EXISTS app;\nCOMMIT;\n`);
    fs.writeFileSync(path.join(projectDir, 'revert/app_schema.sql'), `-- Revert ${projName}:app_schema from ${engine}\n\nBEGIN;\nDROP SCHEMA IF EXISTS app CASCADE;\nCOMMIT;\n`);
    fs.writeFileSync(path.join(projectDir, 'verify/app_schema.sql'), `-- Verify ${projName}:app_schema on ${engine}\n\nBEGIN;\nSELECT 1/count(*) FROM information_schema.schemata WHERE schema_name = 'app';\nCOMMIT;\n`);

    fs.writeFileSync(path.join(projectDir, 'deploy/users_table.sql'), `-- Deploy ${projName}:users_table to ${engine}\n\nBEGIN;\nCREATE TABLE app.users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL,\n  password_hash VARCHAR(255) NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);\nCOMMIT;\n`);
    fs.writeFileSync(path.join(projectDir, 'revert/users_table.sql'), `-- Revert ${projName}:users_table from ${engine}\n\nBEGIN;\nDROP TABLE IF EXISTS app.users;\nCOMMIT;\n`);
    fs.writeFileSync(path.join(projectDir, 'verify/users_table.sql'), `-- Verify ${projName}:users_table on ${engine}\n\nBEGIN;\nSELECT id, email FROM app.users WHERE false;\nCOMMIT;\n`);
  }

  addDemoChangeFiles(projectDir, changeName, args) {
    const planPath = path.join(projectDir, 'sqitch.plan');
    const now = new Date().toISOString();
    const reqArg = args.find(a => a.startsWith('-r') || a.startsWith('--requires')) || '';
    const noteArg = args.find(a => a.startsWith('-n') || a.startsWith('--note')) || '';

    let reqsStr = '';
    if (reqArg) {
      const reqVal = reqArg.split('=')[1] || 'users_table';
      reqsStr = ` [${reqVal}]`;
    }

    let noteStr = 'Added change';
    if (noteArg) {
      noteStr = noteArg.split('=')[1] || noteStr;
    }

    const changeLine = `\n${changeName}${reqsStr} ${now} Sqitch Developer <dev@example.com> # ${noteStr}\n`;
    fs.appendFileSync(planPath, changeLine, 'utf8');

    const dirs = ['deploy', 'revert', 'verify'];
    dirs.forEach(d => {
      const dirPath = path.join(projectDir, d);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    });

    fs.writeFileSync(path.join(projectDir, `deploy/${changeName}.sql`), `-- Deploy change: ${changeName}\n\nBEGIN;\n-- Write deploy SQL here\n\nCOMMIT;\n`);
    fs.writeFileSync(path.join(projectDir, `revert/${changeName}.sql`), `-- Revert change: ${changeName}\n\nBEGIN;\n-- Write revert SQL here\n\nCOMMIT;\n`);
    fs.writeFileSync(path.join(projectDir, `verify/${changeName}.sql`), `-- Verify change: ${changeName}\n\nBEGIN;\n-- Write verify SQL here\n\nCOMMIT;\n`);
  }
}

module.exports = SqitchRunner;

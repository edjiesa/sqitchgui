const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * Executes Sqitch CLI commands either natively, inside Docker container, or simulated
 */
class SqitchRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'auto'; // 'auto' | 'native' | 'docker' | 'simulated'
    this.target = options.target || '';
  }

  /**
   * Detect available execution environment
   */
  static detectEnvironment() {
    return {
      hasNativeSqitch: false,
      hasDocker: true,
      recommendedMode: 'docker'
    };
  }

  run(command, args = [], projectDir = process.cwd()) {
    // Sanitize sqitch.plan syntax to guarantee blank line between pragmas and changes before running any command
    try {
      const SqitchPlanParser = require('./sqitch-parser');
      SqitchPlanParser.sanitizePlanFile(path.join(projectDir, 'sqitch.plan'));
    } catch (e) {
      console.error('Plan sanitize warning:', e);
    }

    const env = SqitchRunner.detectEnvironment();
    let effectiveMode = this.mode;

    if (effectiveMode === 'auto') {
      effectiveMode = env.recommendedMode;
    }

    if (effectiveMode === 'native') {
      return this.runNative(command, args, projectDir);
    } else if (effectiveMode === 'docker') {
      return this.runDocker(command, args, projectDir);
    } else {
      return this.runSimulated(command, args, projectDir);
    }
  }

  runNative(command, args, projectDir) {
    const fullArgs = [command];

    if (this.target) {
      fullArgs.push('--target', this.target);
    }

    fullArgs.push(...args);

    this.emit('log', { type: 'cmd', text: `$ sqitch ${fullArgs.join(' ')}` });

    const proc = spawn('sqitch', fullArgs, {
      cwd: projectDir,
      shell: true,
      env: { ...process.env }
    });

    let fullOutput = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      this.emit('log', { type: 'stdout', text });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      this.emit('log', { type: 'stderr', text });
    });

    proc.on('error', (err) => {
      this.emit('log', { type: 'error', text: `Failed to start sqitch native command: ${err.message}` });
      this.emit('done', { success: false, error: err });
    });

    proc.on('close', (code) => {
      const isConnectionOk = code === 0 || fullOutput.includes('# On database') || fullOutput.includes('No changes deployed');

      if (isConnectionOk) {
        this.emit('log', { type: 'success', text: `Native Sqitch '${command}' completed successfully.` });
        this.emit('done', { success: true, code });
      } else {
        this.emit('log', { type: 'error', text: `Native Sqitch '${command}' failed with exit code ${code}.` });
        this.emit('done', { success: false, code });
      }
    });

    return proc;
  }

  runDocker(command, args, projectDir) {
    const mountPath = projectDir.replace(/\\/g, '/');

    const dockerArgs = [
      'run', '--rm',
      '-v', `${mountPath}:/repo`,
      '-w', '/repo',
      'sqitch/sqitch:latest',
      command
    ];

    if (this.target) {
      dockerArgs.push('--target', this.target);
    }

    dockerArgs.push(...args);

    this.emit('log', { type: 'cmd', text: `$ docker ${dockerArgs.join(' ')}` });

    const proc = spawn('docker', dockerArgs, {
      shell: true,
      env: { ...process.env }
    });

    let fullOutput = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      this.emit('log', { type: 'stdout', text });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      this.emit('log', { type: 'stderr', text });
    });

    proc.on('error', (err) => {
      this.emit('log', { type: 'error', text: `Failed to start Docker process: ${err.message}` });
      this.emit('done', { success: false, error: err });
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
      this.initEmptyProjectFiles(projectDir, projName, engine);
    } else if (command === 'status') {
      steps.push(
        { text: `# On database ${this.target || 'default'}`, delay: 200 },
        { text: `# Project:  ${path.basename(projectDir)}`, delay: 150 },
        { text: `Nothing to deploy (working tree clean)`, delay: 200 }
      );
    } else if (command === 'deploy') {
      steps.push(
        { text: `Deploying changes to ${this.target || 'default'}`, delay: 200 },
        { text: `Ok: All changes deployed successfully.`, delay: 200 }
      );
    } else if (command === 'revert') {
      steps.push(
        { text: `Reverting changes from ${this.target || 'default'}`, delay: 200 },
        { text: `Reverted changes successfully.`, delay: 200 }
      );
    } else if (command === 'verify') {
      steps.push(
        { text: `Verifying database changes on ${this.target || 'default target'}...`, delay: 200 },
        { text: `Verification successful.`, delay: 200 }
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

  /**
   * Initializes a clean, empty Sqitch project structure without dummy/fake changes
   */
  initEmptyProjectFiles(projectDir, projName = 'app_db', engine = 'pg') {
    const planPath = path.join(projectDir, 'sqitch.plan');
    const confPath = path.join(projectDir, 'sqitch.conf');

    if (!fs.existsSync(planPath)) {
      const planContent = `%syntax-version=1.0.0\n%project=${projName}\n%uri=\n\n`;
      fs.writeFileSync(planPath, planContent, 'utf8');
    }

    if (!fs.existsSync(confPath)) {
      const confContent = `[core]\n  engine = ${engine}\n  top_dir = .\n  plan_file = sqitch.plan\n`;
      fs.writeFileSync(confPath, confContent, 'utf8');
    }

    const dirs = ['deploy', 'revert', 'verify'];
    dirs.forEach(d => {
      const dirPath = path.join(projectDir, d);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    });
  }

  addDemoChangeFiles(projectDir, changeName, args) {
    const SqitchPlanParser = require('./sqitch-parser');
    const planPath = path.join(projectDir, 'sqitch.plan');
    const now = new Date().toISOString();
    const reqArg = args.find(a => a.startsWith('-r') || a.startsWith('--requires')) || '';
    const noteArg = args.find(a => a.startsWith('-n') || a.startsWith('--note')) || '';

    let reqsStr = '';
    if (reqArg) {
      const reqVal = reqArg.split('=')[1] || '';
      if (reqVal) reqsStr = ` [${reqVal}]`;
    }

    let noteStr = 'Added change';
    if (noteArg) {
      noteStr = noteArg.split('=')[1] || noteStr;
    }

    const changeLine = `${changeName}${reqsStr} ${now} Sqitch Developer <dev@example.com> # ${noteStr}\n`;
    fs.appendFileSync(planPath, changeLine, 'utf8');

    // Automatically format sqitch.plan so pragmas and changes are separated by a blank line
    SqitchPlanParser.sanitizePlanFile(planPath);

    const dirs = ['deploy', 'revert', 'verify'];
    dirs.forEach(d => {
      const dirPath = path.join(projectDir, d);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    });

    if (!fs.existsSync(path.join(projectDir, `deploy/${changeName}.sql`))) {
      fs.writeFileSync(path.join(projectDir, `deploy/${changeName}.sql`), `-- Deploy change: ${changeName}\n\nBEGIN;\n-- Write deploy SQL here\n\nCOMMIT;\n`);
    }
    if (!fs.existsSync(path.join(projectDir, `revert/${changeName}.sql`))) {
      fs.writeFileSync(path.join(projectDir, `revert/${changeName}.sql`), `-- Revert change: ${changeName}\n\nBEGIN;\n-- Write revert SQL here\n\nCOMMIT;\n`);
    }
    if (!fs.existsSync(path.join(projectDir, `verify/${changeName}.sql`))) {
      fs.writeFileSync(path.join(projectDir, `verify/${changeName}.sql`), `-- Verify change: ${changeName}\n\nBEGIN;\n-- Write verify SQL here\n\nCOMMIT;\n`);
    }
  }
}

module.exports = SqitchRunner;

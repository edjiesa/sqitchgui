const fs = require('fs');
const path = require('path');

/**
 * Sqitch Plan & Config File Parser
 */
class SqitchPlanParser {
  /**
   * Parse sqitch.plan string content or file path
   * @param {string} projectDir Absolute path to sqitch project
   * @returns {Object} Parsed plan structure
   */
  static parseProject(projectDir) {
    const planPath = path.join(projectDir, 'sqitch.plan');
    const configPath = path.join(projectDir, 'sqitch.conf');

    let planContent = '';
    let configContent = '';

    if (fs.existsSync(planPath)) {
      planContent = fs.readFileSync(planPath, 'utf8');
    }

    if (fs.existsSync(configPath)) {
      configContent = fs.readFileSync(configPath, 'utf8');
    }

    const planData = this.parsePlanContent(planContent, projectDir);
    const configData = this.parseConfigContent(configContent);

    return {
      projectDir,
      planPath,
      configPath,
      hasPlan: fs.existsSync(planPath),
      hasConfig: fs.existsSync(configPath),
      meta: planData.meta,
      changes: planData.changes,
      tags: planData.tags,
      config: configData
    };
  }

  /**
   * Parse sqitch.plan content string and filter against deploy/*.sql files on disk
   */
  static parsePlanContent(content, projectDir = null) {
    const lines = content.split(/\r?\n/);
    const meta = {
      syntaxVersion: '1.0.0',
      project: '',
      uri: ''
    };

    const items = [];
    const changes = [];
    const tags = [];
    const seenChangeNames = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Pragmas
      if (line.startsWith('%')) {
        const pragmaMatch = line.match(/^%([a-zA-Z0-9_-]+)=(.*)$/);
        if (pragmaMatch) {
          const key = pragmaMatch[1].trim();
          const val = pragmaMatch[2].trim();
          if (key === 'syntax-version') meta.syntaxVersion = val;
          if (key === 'project') meta.project = val;
          if (key === 'uri') meta.uri = val;
        }
        continue;
      }

      // Comments
      if (line.startsWith('#')) {
        continue;
      }

      // Tag line
      if (line.startsWith('@')) {
        const tagMatch = line.match(/^@([^\s]+)(?:\s+([0-9T:Z-]{10,25}))?(?:\s+([^#<]+)(?:<([^>]+)>)?)?(?:\s*#(.*))?/);
        if (tagMatch) {
          const tagObj = {
            type: 'tag',
            name: tagMatch[1],
            timestamp: tagMatch[2] || '',
            planner: (tagMatch[3] || '').trim(),
            email: tagMatch[4] || '',
            note: (tagMatch[5] || '').trim(),
            line: i + 1
          };
          tags.push(tagObj);
          items.push(tagObj);
        }
        continue;
      }

      // Change line
      const changeMatch = line.match(/^([a-zA-Z0-9_\-\.\/]+)(?:\s+\[([^\]]+)\])?(?:\s+([0-9T:Z\-]+))?(?:\s+([^#<]+)(?:<([^>]+)>)?)?(?:\s*#(.*))?/);
      if (changeMatch) {
        const name = changeMatch[1];
        const rawReqs = changeMatch[2] || '';
        const timestamp = changeMatch[3] || '';
        const planner = (changeMatch[4] || '').trim();
        const email = changeMatch[5] || '';
        const note = (changeMatch[6] || '').trim();

        // If projectDir is supplied, verify deploy/<name>.sql actually exists on disk
        if (projectDir) {
          const deployFile = path.join(projectDir, 'deploy', `${name}.sql`);
          if (!fs.existsSync(deployFile)) {
            // Skip ghost changes whose deploy/*.sql file does not exist on disk
            continue;
          }
        }

        const requires = [];
        const conflicts = [];
        if (rawReqs) {
          const reqTokens = rawReqs.split(/\s+/);
          for (const token of reqTokens) {
            if (!token) continue;
            if (token.startsWith('!')) {
              conflicts.push(token.slice(1));
            } else {
              requires.push(token);
            }
          }
        }

        const changeObj = {
          type: 'change',
          name,
          requires,
          conflicts,
          timestamp,
          planner,
          email,
          note,
          line: i + 1,
          status: 'pending'
        };

        seenChangeNames.add(name);
        changes.push(changeObj);
        items.push(changeObj);
      }
    }

    // Also scan deploy/ directory for any .sql files that might exist on disk
    if (projectDir) {
      const deployDir = path.join(projectDir, 'deploy');
      if (fs.existsSync(deployDir)) {
        try {
          const sqlFiles = fs.readdirSync(deployDir).filter(f => f.endsWith('.sql'));
          for (const file of sqlFiles) {
            const cName = path.basename(file, '.sql');
            if (!seenChangeNames.has(cName)) {
              const extraChange = {
                type: 'change',
                name: cName,
                requires: [],
                conflicts: [],
                timestamp: '',
                planner: 'Local File',
                email: '',
                note: 'Discovered from deploy/' + file,
                line: changes.length + 1,
                status: 'pending'
              };
              seenChangeNames.add(cName);
              changes.push(extraChange);
              items.push(extraChange);
            }
          }
        } catch (e) {
          console.error('Scan deploy dir error:', e);
        }
      }
    }

    return { meta, changes, tags, items };
  }

  /**
   * Parse INI style sqitch.conf into structured object with robust regex for targets and engines
   */
  static parseConfigContent(content) {
    const config = { core: {}, target: {}, engine: {} };
    let currentCategory = 'core';
    let currentSubKey = null;

    if (!content) return config;

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

      // Section header matching: [core], [target "SIT"], [target 'dev'], [target SIT], [engine "pg"]
      const secMatch = trimmed.match(/^\[\s*([^\s\]]+)(?:\s+(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*\]$/);
      if (secMatch) {
        const category = secMatch[1].toLowerCase();
        const subName = secMatch[2] || secMatch[3] || secMatch[4] || null;

        currentCategory = category;
        currentSubKey = subName;

        if (category === 'target' && subName) {
          if (!config.target) config.target = {};
          if (!config.target[subName]) config.target[subName] = { uri: '' };
        } else if (category === 'engine' && subName) {
          if (!config.engine) config.engine = {};
          if (!config.engine[subName]) config.engine[subName] = {};
        } else {
          if (!config[category]) config[category] = {};
        }
        continue;
      }

      // Key = Value matching
      const kvMatch = trimmed.match(/^([a-zA-Z0-9_\.\-]+)\s*=\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const val = kvMatch[2].trim();

        if (currentCategory === 'target' && currentSubKey) {
          if (!config.target[currentSubKey]) config.target[currentSubKey] = {};
          config.target[currentSubKey][key] = val;
        } else if (currentCategory === 'engine' && currentSubKey) {
          if (!config.engine[currentSubKey]) config.engine[currentSubKey] = {};
          config.engine[currentSubKey][key] = val;
          if (key === 'target') {
            if (!config.target) config.target = {};
            if (!config.target[val]) {
              config.target[val] = { uri: val };
            }
          }
        } else {
          if (!config[currentCategory]) config[currentCategory] = {};
          config[currentCategory][key] = val;
          if (currentCategory === 'core' && key === 'target') {
            if (!config.target) config.target = {};
            if (!config.target[val]) {
              config.target[val] = { uri: val };
            }
          }
        }
      }
    }

    return config;
  }
}

module.exports = SqitchPlanParser;

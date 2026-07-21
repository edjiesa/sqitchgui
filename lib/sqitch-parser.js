const fs = require('fs');
const path = require('path');

/**
 * Sqitch Plan & Config File Parser
 */
class SqitchPlanParser {
  /**
   * Sanitize sqitch.plan file to strip invalid empty pragmas and fix timestamp format (YYYY-MM-DDTHH:mm:ssZ)
   */
  static sanitizePlanFile(planPath) {
    if (!planPath || !fs.existsSync(planPath)) return;
    try {
      const content = fs.readFileSync(planPath, 'utf8');
      const lines = content.split(/\r?\n/);
      const pragmas = [];
      const restLines = [];
      let pastPragmas = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!pastPragmas && (trimmed.startsWith('%') || (pragmas.length > 0 && trimmed === ''))) {
          if (trimmed.startsWith('%')) {
            if (trimmed === '%uri=' || trimmed === '%uri' || trimmed.match(/^%[a-zA-Z0-9_-]+=\s*$/)) {
              continue;
            }
            pragmas.push(trimmed);
          }
        } else {
          if (trimmed !== '') {
            pastPragmas = true;
          }
          if (pastPragmas) {
            restLines.push(line);
          }
        }
      }

      if (pragmas.length === 0) {
        pragmas.push('%syntax-version=1.0.0');
        pragmas.push('%project=app_db');
      }

      const sqitchNow = new Date().toISOString().split('.')[0] + 'Z';
      const sanitizedRestLines = restLines.map(line => {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) {
          return line;
        }

        // Clean up any milliseconds in existing timestamps (e.g. 2026-07-21T08:07:33.123Z -> 2026-07-21T08:07:33Z)
        trimmed = trimmed.replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d+Z/g, '$1Z');

        // Check if change line has a valid Sqitch timestamp (YYYY-MM-DDTHH:mm:ssZ)
        if (!trimmed.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/)) {
          const match = trimmed.match(/^([a-zA-Z0-9_\-\.\/]+)(?:\s+\[([^\]]+)\])?(?:\s*#(.*))?/);
          if (match) {
            const name = match[1];
            const reqs = match[2] ? ` [${match[2]}]` : '';
            const note = match[3] ? ` # ${match[3].trim()}` : '';
            return `${name}${reqs} ${sqitchNow} Sqitch Developer <dev@example.com>${note}`;
          }
        }
        return trimmed;
      });

      const restContent = sanitizedRestLines.join('\n').trim();
      const cleanPlan = pragmas.join('\n') + '\n\n' + (restContent ? restContent + '\n' : '');
      
      fs.writeFileSync(planPath, cleanPlan, 'utf8');
    } catch (e) {
      console.error('Error sanitizing sqitch.plan:', e);
    }
  }

  /**
   * Parse sqitch.plan string content or file path
   * @param {string} projectDir Absolute path to sqitch project
   * @returns {Object} Parsed plan structure
   */
  static parseProject(projectDir) {
    const planPath = path.join(projectDir, 'sqitch.plan');
    const configPath = path.join(projectDir, 'sqitch.conf');

    // Auto-sanitize sqitch.plan formatting before parsing
    this.sanitizePlanFile(planPath);

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

      // Disabled / Commented out change line (# name ...)
      if (line.startsWith('#')) {
        const disabledMatch = line.match(/^#\s*([a-zA-Z0-9_\-\.\/]+)(?:\s+\[([^\]]+)\])?(?:\s+([0-9T:Z\-]+))?(?:\s+([^#<]+)(?:<([^>]+)>)?)?(?:\s*#(.*))?/);
        if (disabledMatch && !line.startsWith('##') && !line.startsWith('#%')) {
          const name = disabledMatch[1];
          if (name && !seenChangeNames.has(name)) {
            const changeObj = {
              type: 'change',
              name,
              requires: [],
              conflicts: [],
              timestamp: disabledMatch[3] || '',
              planner: 'Disabled (#)',
              email: '',
              note: (disabledMatch[6] || 'Nonaktif di sqitch.plan').trim(),
              line: i + 1,
              status: 'disabled',
              disabled: true
            };
            seenChangeNames.add(name);
            changes.push(changeObj);
            items.push(changeObj);
          }
        }
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
          status: 'pending',
          disabled: false
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
                status: 'pending',
                disabled: false
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

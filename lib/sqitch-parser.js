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

    const planData = this.parsePlanContent(planContent);
    const configData = this.parseConfigContent(configContent);

    return {
      projectDir,
      planPath,
      hasPlan: fs.existsSync(planPath),
      hasConfig: fs.existsSync(configPath),
      meta: planData.meta,
      changes: planData.changes,
      tags: planData.tags,
      config: configData
    };
  }

  /**
   * Parse sqitch.plan content string
   */
  static parsePlanContent(content) {
    const lines = content.split(/\r?\n/);
    const meta = {
      syntaxVersion: '1.0.0',
      project: '',
      uri: ''
    };

    const items = [];
    const changes = [];
    const tags = [];

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

        changes.push(changeObj);
        items.push(changeObj);
      }
    }

    return { meta, changes, tags, items };
  }

  /**
   * Parse INI style sqitch.conf into structured object
   */
  static parseConfigContent(content) {
    const config = { core: {}, target: {}, engine: {} };
    let currentSection = 'core';

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

      const secMatch = trimmed.match(/^\[(.*)\]$/);
      if (secMatch) {
        currentSection = secMatch[1].trim();
        if (currentSection.startsWith('target "')) {
          const tName = currentSection.slice(8, -1);
          if (!config.target) config.target = {};
          if (!config.target[tName]) config.target[tName] = {};
          currentSection = `target:${tName}`;
        } else if (currentSection.startsWith('engine "')) {
          const eName = currentSection.slice(8, -1);
          if (!config.engine) config.engine = {};
          if (!config.engine[eName]) config.engine[eName] = {};
          currentSection = `engine:${eName}`;
        } else {
          if (!config[currentSection]) config[currentSection] = {};
        }
        continue;
      }

      const kvMatch = trimmed.match(/^([a-zA-Z0-9_\.\-]+)\s*=\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const val = kvMatch[2].trim();

        if (currentSection.startsWith('target:')) {
          const tName = currentSection.split(':')[1];
          config.target[tName][key] = val;
        } else if (currentSection.startsWith('engine:')) {
          const eName = currentSection.split(':')[1];
          config.engine[eName][key] = val;
        } else {
          if (!config[currentSection]) config[currentSection] = {};
          config[currentSection][key] = val;
        }
      }
    }

    return config;
  }
}

module.exports = SqitchPlanParser;

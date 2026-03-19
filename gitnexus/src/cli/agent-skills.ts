import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AgentSkillTarget {
  key: 'claude' | 'cursor' | 'opencode' | 'codex';
  label: string;
  rootDir: string;
  skillsDir: string;
  displayPath: string;
}

interface AgentSkillTargetDefinition {
  key: AgentSkillTarget['key'];
  label: string;
  relativeRoot: string[];
  relativeSkillsDir: string[];
}

const AGENT_SKILL_TARGETS: AgentSkillTargetDefinition[] = [
  {
    key: 'claude',
    label: 'Claude Code',
    relativeRoot: ['.claude'],
    relativeSkillsDir: ['.claude', 'skills'],
  },
  {
    key: 'cursor',
    label: 'Cursor',
    relativeRoot: ['.cursor'],
    relativeSkillsDir: ['.cursor', 'skills'],
  },
  {
    key: 'opencode',
    label: 'OpenCode',
    relativeRoot: ['.config', 'opencode'],
    relativeSkillsDir: ['.config', 'opencode', 'skill'],
  },
  {
    key: 'codex',
    label: 'Codex',
    relativeRoot: ['.codex'],
    relativeSkillsDir: ['.codex', 'skills'],
  },
];

function getSkillsRoot(): string {
  return path.join(__dirname, '..', '..', 'skills');
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function discoverAgentSkillTargets(homeDir = os.homedir()): Promise<AgentSkillTarget[]> {
  const discovered: AgentSkillTarget[] = [];

  for (const def of AGENT_SKILL_TARGETS) {
    const rootDir = path.join(homeDir, ...def.relativeRoot);
    if (!(await dirExists(rootDir))) continue;

    discovered.push({
      key: def.key,
      label: def.label,
      rootDir,
      skillsDir: path.join(homeDir, ...def.relativeSkillsDir),
      displayPath: `~/${def.relativeSkillsDir.join('/')}/`,
    });
  }

  return discovered;
}

/**
 * Install GitNexus packaged skills to a target directory.
 *
 * Supports two source layouts:
 *   - Flat file:  skills/{name}.md           → copied as SKILL.md
 *   - Directory:  skills/{name}/SKILL.md     → copied recursively (includes references/, etc.)
 */
export async function installSkillsTo(targetDir: string, skillsRoot = getSkillsRoot()): Promise<string[]> {
  const installed: string[] = [];

  let flatFiles: string[] = [];
  let dirSkillFiles: string[] = [];
  try {
    [flatFiles, dirSkillFiles] = await Promise.all([
      glob('*.md', { cwd: skillsRoot }),
      glob('*/SKILL.md', { cwd: skillsRoot }),
    ]);
  } catch {
    return [];
  }

  const skillSources = new Map<string, { isDirectory: boolean }>();

  for (const relPath of dirSkillFiles) {
    skillSources.set(path.dirname(relPath), { isDirectory: true });
  }
  for (const relPath of flatFiles) {
    const skillName = path.basename(relPath, '.md');
    if (!skillSources.has(skillName)) {
      skillSources.set(skillName, { isDirectory: false });
    }
  }

  for (const [skillName, source] of skillSources) {
    const skillDir = path.join(targetDir, skillName);

    try {
      if (source.isDirectory) {
        const dirSource = path.join(skillsRoot, skillName);
        await copyDirRecursive(dirSource, skillDir);
        installed.push(skillName);
      } else {
        const flatSource = path.join(skillsRoot, `${skillName}.md`);
        const content = await fs.readFile(flatSource, 'utf-8');
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
        installed.push(skillName);
      }
    } catch {
      // Source skill not found — skip
    }
  }

  return installed;
}

export async function installRepoSkillToTargets(
  targets: AgentSkillTarget[],
  skillName: string,
  content: string,
): Promise<string[]> {
  const installed: string[] = [];

  for (const target of targets) {
    const skillDir = path.join(target.skillsDir, skillName);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
    installed.push(`${target.label} repo context skill (${target.displayPath}${skillName}/)`);
  }

  return installed;
}

/**
 * Recursively copy a directory tree.
 */
export async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

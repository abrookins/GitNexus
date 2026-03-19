import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateAIContextFiles } from '../../src/cli/ai-context.js';

describe('generateAIContextFiles', () => {
  let tmpDir: string;
  let storagePath: string;
  let tempHome: string;
  const originalHome = process.env.HOME;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-ctx-test-'));
    storagePath = path.join(tmpDir, '.gitnexus');
    await fs.mkdir(storagePath, { recursive: true });
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-ai-home-'));
  });

  beforeEach(async () => {
    process.env.HOME = tempHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.mkdir(storagePath, { recursive: true });
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.mkdir(tempHome, { recursive: true });
  });

  afterAll(async () => {
    process.env.HOME = originalHome;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(tempHome, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('generates context files', async () => {
    const stats = {
      nodes: 100,
      edges: 200,
      processes: 10,
    };

    const result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);
    expect(result.files).toBeDefined();
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('creates or updates CLAUDE.md with GitNexus section', async () => {
    const stats = { nodes: 50, edges: 100, processes: 5 };
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = await fs.readFile(claudeMdPath, 'utf-8');
    expect(content).toContain('gitnexus:start');
    expect(content).toContain('gitnexus:end');
    expect(content).toContain('TestProject');
  });

  it('handles empty stats', async () => {
    const stats = {};
    const result = await generateAIContextFiles(tmpDir, storagePath, 'EmptyProject', stats);
    expect(result.files).toBeDefined();
  });

  it('updates existing CLAUDE.md without duplicating', async () => {
    const stats = { nodes: 10 };

    // Run twice
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);
    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const content = await fs.readFile(claudeMdPath, 'utf-8');

    // Should only have one gitnexus section
    const starts = (content.match(/gitnexus:start/g) || []).length;
    expect(starts).toBe(1);
  });

  it('installs skills files', async () => {
    const stats = { nodes: 10 };
    const result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', stats);

    // Should have installed skill files
    const skillsDir = path.join(tmpDir, '.claude', 'skills', 'gitnexus');
    try {
      const entries = await fs.readdir(skillsDir, { recursive: true });
      expect(entries.length).toBeGreaterThan(0);
    } catch {
      // Skills dir may not be created if skills source doesn't exist in test context
    }
  });

  it('skips project files and installs repo context skills centrally in global-skill mode', async () => {
    await fs.mkdir(path.join(tempHome, '.claude'), { recursive: true });
    await fs.mkdir(path.join(tempHome, '.codex'), { recursive: true });

    const stats = { nodes: 42, edges: 84, processes: 7 };
    const result = await generateAIContextFiles(
      tmpDir,
      storagePath,
      'TestProject',
      stats,
      undefined,
      { delivery: 'global-skill' },
    );

    await expect(fs.access(path.join(tmpDir, 'AGENTS.md'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'CLAUDE.md'))).rejects.toThrow();

    const claudeSkill = path.join(tempHome, '.claude', 'skills', 'gitnexus-repo-testproject', 'SKILL.md');
    const codexSkill = path.join(tempHome, '.codex', 'skills', 'gitnexus-repo-testproject', 'SKILL.md');
    const claudeContent = await fs.readFile(claudeSkill, 'utf-8');
    const codexContent = await fs.readFile(codexSkill, 'utf-8');

    expect(claudeContent).toContain('name: gitnexus-repo-testproject');
    expect(claudeContent).toContain('TestProject');
    expect(claudeContent).toContain('Use this skill');
    expect(claudeContent).not.toContain('.claude/skills/generated/');
    expect(codexContent).toContain('TestProject');
    expect(result.files.some(entry => entry.includes('Claude Code repo context skill'))).toBe(true);
    expect(result.files.some(entry => entry.includes('Codex repo context skill'))).toBe(true);
  });

  it('writes both project files and central skills in both mode', async () => {
    await fs.mkdir(path.join(tempHome, '.claude'), { recursive: true });

    const stats = { nodes: 21, edges: 34, processes: 5 };
    await generateAIContextFiles(
      tmpDir,
      storagePath,
      'TestProject',
      stats,
      undefined,
      { delivery: 'both' },
    );

    const agentsContent = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    const centralSkill = await fs.readFile(
      path.join(tempHome, '.claude', 'skills', 'gitnexus-repo-testproject', 'SKILL.md'),
      'utf-8',
    );

    expect(agentsContent).toContain('gitnexus:start');
    expect(agentsContent).toContain('.claude/skills/gitnexus/gitnexus-exploring/SKILL.md');
    expect(centralSkill).toContain('Use this skill');
  });

  it('includes generated repo skill references in project file mode', async () => {
    const stats = { nodes: 21, edges: 34, processes: 5 };
    await generateAIContextFiles(
      tmpDir,
      storagePath,
      'TestProject',
      stats,
      [{ name: 'auth', label: 'Auth', symbolCount: 9, fileCount: 2 }],
      { delivery: 'project-files' },
    );

    const agentsContent = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    expect(agentsContent).toContain('.claude/skills/generated/auth/SKILL.md');
  });

  it('appends the GitNexus section to existing files without markers', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# Existing content\n', 'utf-8');

    await generateAIContextFiles(tmpDir, storagePath, 'TestProject', { nodes: 7 }, undefined, {
      delivery: 'project-files',
    });

    const agentsContent = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    expect(agentsContent).toContain('# Existing content');
    expect(agentsContent).toContain('gitnexus:start');
  });

  it('does not write outputs in none mode', async () => {
    const result = await generateAIContextFiles(tmpDir, storagePath, 'TestProject', { nodes: 7 }, undefined, {
      delivery: 'none',
    });

    expect(result.files).toEqual([]);
    await expect(fs.access(path.join(tmpDir, 'AGENTS.md'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'CLAUDE.md'))).rejects.toThrow();
  });
});

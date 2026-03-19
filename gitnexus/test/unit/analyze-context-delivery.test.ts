import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const generateAIContextFiles = vi.fn();
const runPipelineFromRepo = vi.fn();
const loadMeta = vi.fn();
const cleanupOldKuzuFiles = vi.fn();
const getGitRoot = vi.fn();
const isGitRepo = vi.fn();
const getCurrentCommit = vi.fn();
const getStoragePaths = vi.fn();

vi.mock('../../src/core/ingestion/pipeline.js', () => ({
  runPipelineFromRepo,
}));

vi.mock('../../src/core/lbug/lbug-adapter.js', () => ({
  initLbug: vi.fn(),
  loadGraphToLbug: vi.fn(),
  getLbugStats: vi.fn(),
  executeQuery: vi.fn(),
  executeWithReusedStatement: vi.fn(),
  closeLbug: vi.fn(),
  createFTSIndex: vi.fn(),
  loadCachedEmbeddings: vi.fn(() => []),
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  getStoragePaths,
  saveMeta: vi.fn(),
  loadMeta,
  addToGitignore: vi.fn(),
  registerRepo: vi.fn(),
  getGlobalRegistryPath: vi.fn(() => '/tmp/registry.json'),
  cleanupOldKuzuFiles,
}));

vi.mock('../../src/storage/git.js', () => ({
  getCurrentCommit,
  isGitRepo,
  getGitRoot,
}));

vi.mock('../../src/cli/ai-context.js', () => ({
  generateAIContextFiles,
}));

vi.mock('../../src/cli/skill-gen.js', () => ({
  generateSkillFiles: vi.fn(),
}));

describe('analyzeCommand context delivery', () => {
  const originalNodeOptions = process.env.NODE_OPTIONS;
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.resetAllMocks();
    logSpy.mockImplementation(() => {});
    process.env.NODE_OPTIONS = '--max-old-space-size=8192';
    process.exitCode = 0;

    cleanupOldKuzuFiles.mockResolvedValue({ found: false, needsReindex: false });
    getGitRoot.mockReturnValue('/repo');
    isGitRepo.mockReturnValue(true);
    getCurrentCommit.mockReturnValue('abc123');
    getStoragePaths.mockReturnValue({ storagePath: '/repo/.gitnexus', lbugPath: '/repo/.gitnexus/lbug.db' });
  });

  afterEach(() => {
    process.env.NODE_OPTIONS = originalNodeOptions;
    process.exitCode = 0;
  });

  it('rejects invalid context delivery modes before running the pipeline', async () => {
    loadMeta.mockResolvedValue(null);

    const { analyzeCommand } = await import('../../src/cli/analyze.js');
    await analyzeCommand(undefined, { contextDelivery: 'bogus' as any });

    expect(runPipelineFromRepo).not.toHaveBeenCalled();
    expect(generateAIContextFiles).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith('  Invalid --context-delivery value: bogus');
  });

  it('uses existing metadata to install context outputs when the repo is already up to date', async () => {
    loadMeta.mockResolvedValue({
      lastCommit: 'abc123',
      stats: { files: 4, nodes: 10, edges: 20, communities: 2, processes: 3 },
    });
    generateAIContextFiles.mockResolvedValue({
      files: ['Claude Code repo context skill (~/.claude/skills/gitnexus-repo-repo/)'],
    });

    const { analyzeCommand } = await import('../../src/cli/analyze.js');
    await analyzeCommand(undefined, { contextDelivery: 'global-skill' });

    expect(runPipelineFromRepo).not.toHaveBeenCalled();
    expect(generateAIContextFiles).toHaveBeenCalledWith(
      '/repo',
      '/repo/.gitnexus',
      'repo',
      expect.objectContaining({ files: 4, nodes: 10, edges: 20, communities: 2, processes: 3 }),
      undefined,
      { delivery: 'global-skill' },
    );
    expect(logSpy).toHaveBeenCalledWith('  Already up to date');
    expect(logSpy).toHaveBeenCalledWith(
      '  Context: Claude Code repo context skill (~/.claude/skills/gitnexus-repo-repo/)\n',
    );
  });

  it('keeps the old up-to-date fast path for default project-files delivery', async () => {
    loadMeta.mockResolvedValue({
      lastCommit: 'abc123',
      stats: { files: 4, nodes: 10, edges: 20, communities: 2, processes: 3 },
    });

    const { analyzeCommand } = await import('../../src/cli/analyze.js');
    await analyzeCommand(undefined, {});

    expect(runPipelineFromRepo).not.toHaveBeenCalled();
    expect(generateAIContextFiles).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('  Already up to date\n');
  });

  it('returns early with no extra context output when the repo is already up to date', async () => {
    loadMeta.mockResolvedValue({
      lastCommit: 'abc123',
      stats: { files: 4, nodes: 10, edges: 20, communities: 2, processes: 3 },
    });
    generateAIContextFiles.mockResolvedValue({ files: [] });

    const { analyzeCommand } = await import('../../src/cli/analyze.js');
    await analyzeCommand(undefined, { contextDelivery: 'none' });

    expect(runPipelineFromRepo).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('  Already up to date\n');
  });
});

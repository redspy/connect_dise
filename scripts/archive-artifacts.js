import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Usage: node scripts/archive-artifacts.js <game-id> <conversation-id> [app-data-dir]
const gameId = process.argv[2];
const convId = process.argv[3];
const appDataDir = process.argv[4] || path.join(process.env.HOME || '', '.gemini/antigravity');

if (!gameId || !convId) {
  console.log('Error: Missing arguments.');
  console.log('Usage: node scripts/archive-artifacts.js <game-id> <conversation-id> [app-data-dir]');
  process.exit(1);
}

const sourceDir = path.join(appDataDir, 'brain', convId);
const targetDir = path.join(rootDir, 'docs', 'games', gameId);

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

// Ensure target directory exists
fs.mkdirSync(targetDir, { recursive: true });

// Mapping of temporary artifacts to repository documentation files
const mappings = [
  { from: 'implementation_plan.md', to: 'spec.md' },
  { from: 'walkthrough.md', to: 'test-report.md' },
  { from: 'task.md', to: 'task-checklist.md' }
];

// Custom handle for selection reports
const selectionReportFilename = `${gameId.replace(/-/g, '_')}_selection_report.md`;

mappings.push({ from: selectionReportFilename, to: 'retrospective-meeting.md' });

mappings.forEach(map => {
  const srcPath = path.join(sourceDir, map.from);
  const dstPath = path.join(targetDir, map.to);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, dstPath);
    console.log(`[Archived] ${map.from} -> docs/games/${gameId}/${map.to}`);
  } else {
    // Check fallback for pirate plunder selection report named statically
    if (map.from.includes('selection_report.md')) {
      const fallbackReport = path.join(sourceDir, 'pirate_plunder_selection_report.md');
      if (fs.existsSync(fallbackReport)) {
        fs.copyFileSync(fallbackReport, dstPath);
        console.log(`[Archived] pirate_plunder_selection_report.md -> docs/games/${gameId}/${map.to}`);
        return;
      }
    }
    console.warn(`[Warning] Source file not found: ${srcPath}`);
  }
});

console.log(`\nSuccessfully archived all deliverables to docs/games/${gameId}/`);

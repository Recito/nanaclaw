#!/usr/bin/env npx tsx
/**
 * Enable host execution mode for a registered group.
 *
 * Usage:
 *   npx tsx scripts/set-host-mode.ts <group-jid> <project-dir>
 *   npx tsx scripts/set-host-mode.ts --disable <group-jid>
 *
 * Examples:
 *   npx tsx scripts/set-host-mode.ts "dc:123456" ~/projects/my-app
 *   npx tsx scripts/set-host-mode.ts --disable "dc:123456"
 */
import { initDatabase, getRegisteredGroup, setRegisteredGroup } from '../src/db.js';
import { validateHostProjectDir } from '../src/host-runner.js';

function usage(): never {
  console.error('Usage:');
  console.error('  npx tsx scripts/set-host-mode.ts <group-jid> <project-dir>');
  console.error('  npx tsx scripts/set-host-mode.ts --disable <group-jid>');
  process.exit(1);
}

initDatabase();

const args = process.argv.slice(2);

if (args[0] === '--disable') {
  const jid = args[1];
  if (!jid) usage();

  const group = getRegisteredGroup(jid);
  if (!group) {
    console.error(`Group not found: ${jid}`);
    process.exit(1);
  }

  setRegisteredGroup(jid, {
    ...group,
    execution: 'container',
    hostConfig: undefined,
  });
  console.log(`Disabled host mode for ${group.name} (${jid}). Back to container mode.`);
  process.exit(0);
}

const [jid, projectDir] = args;
if (!jid || !projectDir) usage();

const group = getRegisteredGroup(jid);
if (!group) {
  console.error(`Group not found: ${jid}`);
  process.exit(1);
}

const resolvedDir = projectDir.startsWith('~')
  ? projectDir.replace('~', process.env.HOME || '')
  : projectDir;

const error = validateHostProjectDir(resolvedDir);
if (error) {
  console.error(`Validation failed: ${error}`);
  console.error('');
  console.error('Make sure the project directory is listed in your mount allowlist:');
  console.error('  ~/.config/nanoclaw/mount-allowlist.json');
  process.exit(1);
}

setRegisteredGroup(jid, {
  ...group,
  execution: 'host',
  hostConfig: { projectDir: resolvedDir },
});

console.log(`Host mode enabled for ${group.name} (${jid})`);
console.log(`  Project dir: ${resolvedDir}`);
console.log('');
console.log('Restart the service for changes to take effect:');
console.log('  launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS');
console.log('  systemctl --user restart nanoclaw                  # Linux');

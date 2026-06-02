#!/usr/bin/env node

const { spawn, execSync } = require('child_process')

function clearCache() {
  try {
    execSync('rm -rf apps/client/.expo', { stdio: 'pipe' })
    execSync('rm -rf apps/client/node_modules/.cache', { stdio: 'pipe' })
  } catch {
    // non-critical
  }
}

clearCache()

console.log('BMO starting...\n')
console.log('  API    → http://localhost:3000')
console.log('  Client → http://localhost:8081\n')

const proc = spawn('bunx', [
  'turbo', 'run', 'dev',
  '--filter=./apps/api',
  '--filter=./apps/client',
  '--ui', 'tui',
], {
  stdio: 'inherit',
  shell: true,
})

proc.on('exit', (code) => {
  process.exit(code || 0)
})

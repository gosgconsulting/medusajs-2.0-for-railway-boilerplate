const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const MEDUSA_SERVER_PATH = path.join(process.cwd(), '.medusa', 'server');

// Check if .medusa/server exists - if not, build process failed
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  throw new Error('.medusa/server directory not found. This indicates the Medusa build process failed. Please check for build errors.');
}

// Copy pnpm-lock.yaml
fs.copyFileSync(
  path.join(process.cwd(), 'pnpm-lock.yaml'),
  path.join(MEDUSA_SERVER_PATH, 'pnpm-lock.yaml')
);

// Sync pnpm field for patchedDependencies
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const serverPackageJsonPath = path.join(MEDUSA_SERVER_PATH, 'package.json');
const serverPackageJson = JSON.parse(fs.readFileSync(serverPackageJsonPath, 'utf8'));

if (rootPackageJson.pnpm) {
  serverPackageJson.pnpm = rootPackageJson.pnpm;
  fs.writeFileSync(serverPackageJsonPath, JSON.stringify(serverPackageJson, null, 2));
}

// Copy .env if it exists
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  fs.copyFileSync(
    envPath,
    path.join(MEDUSA_SERVER_PATH, '.env')
  );
}

// Copy patches if they exist
const patchesPath = path.join(process.cwd(), 'patches');
if (fs.existsSync(patchesPath)) {
  fs.cpSync(patchesPath, path.join(MEDUSA_SERVER_PATH, 'patches'), { recursive: true });
}

// Install dependencies
console.log('Installing dependencies in .medusa/server...');
execSync('pnpm i --prod --frozen-lockfile', { 
  cwd: MEDUSA_SERVER_PATH,
  stdio: 'inherit'
});

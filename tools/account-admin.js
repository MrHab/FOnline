const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

const login = normalizeLogin(option('--login'));
const email = normalizeEmail(option('--email'));
const password = String(process.env.REALM_NEW_PASSWORD || '');
if (!login) fail('Usage: node tools/account-admin.js --login <login> [--email <email>]');
if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email) || email.length > 254)) fail('Invalid email.');
if (password && (password.length < 8 || password.length > 128)) fail('REALM_NEW_PASSWORD must contain 8-128 characters.');
if (!email && !password) fail('Provide --email and/or REALM_NEW_PASSWORD.');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const db = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
const user = db.users?.[login];
if (!user) fail(`Account not found: ${login}`);
if (email) {
  const duplicate = Object.values(db.users || {}).find(candidate => candidate !== user && normalizeEmail(candidate?.email) === email);
  if (duplicate) fail('Email is already used by another account.');
  user.email = email;
}
if (password) {
  const { salt, hash } = hashPassword(password);
  user.salt = salt;
  user.passwordHash = hash;
  user.passwordChangedAt = Date.now();
  delete user.passwordReset;
  for (const [token, session] of Object.entries(db.sessions || {})) {
    if (session?.login === login) delete db.sessions[token];
  }
}

const temporaryFile = `${usersFile}.tmp`;
fs.writeFileSync(temporaryFile, JSON.stringify(db, null, 2));
fs.renameSync(temporaryFile, usersFile);
console.log(`Account updated: ${login}; email=${email ? 'yes' : 'unchanged'}; password=${password ? 'changed' : 'unchanged'}`);

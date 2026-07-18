const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
for (const name of fs.readdirSync(root)) {
  if (/^PATCH_NOTES.*\.md$/i.test(name)) {
    fs.rmSync(path.join(root, name), { force: true });
  }
}
fs.rmSync(path.join(root, 'docs', 'wiki', 'CHANGELOG.md'), { force: true });
console.log('Removed root PATCH_NOTES*.md files and docs/wiki/CHANGELOG.md');

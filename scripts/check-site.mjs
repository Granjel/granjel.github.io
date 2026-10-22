import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const failures = [];
let links = 0;
for (const filename of ['index.html', 'publications.html', 'about.html', 'contact.html', '404.html']) {
  const html = await readFile(path.join(root, filename), 'utf8');
  if (!html.includes('<main id="main">')) failures.push(filename + ': missing main landmark');
  if ((html.match(/<h1\b/g) || []).length !== 1) failures.push(filename + ': expected one primary heading');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) failures.push(filename + ': duplicate element IDs');
  for (const image of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="[^"]+"/.test(image[0])) failures.push(filename + ': missing image description');
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const url = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
    const relative = decodeURIComponent(url.split(/[?#]/)[0]);
    if (!relative) continue;
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(root + path.sep)) { failures.push(filename + ': path outside output'); continue; }
    links++;
    try { await access(resolved); } catch { failures.push(filename + ': missing ' + relative); }
  }
}
async function checkFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkFiles(target);
    else if (/\.(xlsx?|csv|pem|key)$/i.test(entry.name) || /^\.env/.test(entry.name) || /credentials|service-account/.test(entry.name)) failures.push('Private-source file in output: ' + path.relative(root, target));
  }
}
await checkFiles(root);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Site checks passed: 5 HTML pages; ' + links + ' local links; no spreadsheet or credential files in output.');

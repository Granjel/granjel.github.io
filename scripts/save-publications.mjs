import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { validatePublicationData } from './publications.mjs';

const exec = promisify(execFile);
const run = async args => (await exec('git', args, { timeout: 30000, maxBuffer: 65536 })).stdout.trim();
try {
  const snapshot = validatePublicationData(JSON.parse(await readFile('content/publications.json', 'utf8')));
  if (snapshot.publications.some(p => ['in-preparation', 'submitted', 'under-review'].includes(p.status) && (p.journal || p.year || p.date || p.doi || p.pdf))) throw new Error();
  const changed = Boolean(await run(['diff', '--name-only', '--', 'content/publications.json']));
  const lastCommit = Number(await run(['log', '-1', '--format=%ct']));
  const keepAlive = !changed && Date.now() / 1000 - lastCommit > 45 * 86400;
  if (changed || keepAlive) {
    if (!process.env.GITHUB_TOKEN) throw new Error();
    await run(['config', 'user.name', 'github-actions[bot]']);
    await run(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    if (changed) await run(['commit', '--only', '-m', 'Update public publications from Google Sheet', '--', 'content/publications.json']);
    else {
      if (await run(['diff', '--cached', '--name-only'])) throw new Error();
      await run(['commit', '--allow-empty', '-m', 'Keep publication updates active']);
    }
    const auth = 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + process.env.GITHUB_TOKEN).toString('base64');
    await exec('git', ['push', 'origin', 'HEAD:main'], { timeout: 30000, maxBuffer: 65536, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: auth } });
    console.log(changed ? 'Saved the approved public publication snapshot.' : 'Kept scheduled publication updates active.');
  } else console.log('The public publication snapshot is unchanged.');
} catch {
  console.error('Could not save the public snapshot. Check repository write permissions or retry if main changed during this run.');
  process.exitCode = 1;
}

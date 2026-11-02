import { readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, rowsToPublications, normalizeSheetHeader } from './sheet-publications.mjs';
import { fetchPublicPublicationTabs, SheetSyncError } from './google-sheets.mjs';
import { validatePublicationData, PublicationDataError } from './publications.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function publicationSnapshot(rows, previous, today = new Date().toISOString().slice(0, 10)) {
  return publicationTabsSnapshot([{ kind: 'journal-articles', rows }], previous, today);
}

export function publicationTabsSnapshot(tabs, previous, today = new Date().toISOString().slice(0, 10)) {
  if (!Array.isArray(tabs) || !tabs.length) throw new PublicationDataError('Publication tabs: expected at least one source.');
  const old = validatePublicationData(previous);
  const byDoi = new Map(old.publications.filter(p => p.doi).map(p => [p.doi.toLowerCase(), p]));
  const publications = [];
  for (const { kind, rows } of tabs) {
    let records;
    try { records = rowsToPublications(rows, { kind }); }
    catch (error) {
      if (!(error instanceof PublicationDataError)) throw error;
      throw new PublicationDataError(`${kind === 'books-and-chapters' ? 'books-and-chapters' : 'journal-articles'}: ${error.message}`);
    }
    const headers = new Set(rows[0].map(normalizeSheetHeader));
    const hasDate = headers.has('date') || headers.has('publication_date');
    for (const paper of records) {
      const prior = paper.doi ? byDoi.get(paper.doi.toLowerCase()) : null;
      if (!prior) continue;
      if (!hasDate && ['published', 'preprint'].includes(paper.status) && paper.year === prior.year && prior.date) paper.date = prior.date;
    }
    publications.push(...records);
  }
  const combined = validatePublicationData({ schemaVersion: 1, updatedAt: today, publications });
  const unchanged = JSON.stringify(combined.publications) === JSON.stringify(old.publications);
  return { ...combined, updatedAt: unchanged ? old.updatedAt : today };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvIndex = args.indexOf('--csv');
  if (args.some(a => a.startsWith('--') && !['--csv', '--dry-run'].includes(a)) || (csvIndex !== -1 && !args[csvIndex + 1])) {
    throw new SheetSyncError('Usage: node scripts/sync-publications.mjs [--csv path] [--dry-run]');
  }
  const tabs = csvIndex !== -1
    ? [{ kind: 'journal-articles', rows: parseCsv(await readFile(path.resolve(args[csvIndex + 1]), 'utf8')) }]
    : await fetchPublicPublicationTabs({ spreadsheetId: process.env.GOOGLE_SHEET_ID, credentialsJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON, tab: process.env.GOOGLE_SHEET_TAB || '' });
  const filename = path.join(root, 'content/publications.json');
  const previousText = await readFile(filename, 'utf8');
  const previous = JSON.parse(previousText);
  const snapshot = publicationTabsSnapshot(tabs, previous);
  for (let i = 0; i < snapshot.publications.length; i++) {
    const paper = snapshot.publications[i];
    for (const pdf of [paper.pdf, paper.preprint?.pdf].filter(Boolean)) {
      try { await access(path.join(root, pdf)); }
      catch { throw new PublicationDataError(`Publication ${i + 1} PDF: the file is missing from assets/papers.`); }
    }
  }
  const changed = JSON.stringify(snapshot) !== JSON.stringify(previous);
  if (changed && !dryRun) {
    const temporary = filename + '.tmp';
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
    await rename(temporary, filename);
  }
  const statuses = {};
  for (const paper of snapshot.publications) statuses[paper.status] = (statuses[paper.status] || 0) + 1;
  console.log(JSON.stringify({ source: csvIndex === -1 ? 'private-google-sheet' : 'local-csv', records: snapshot.publications.length, statuses, changed, dryRun }));
  if (process.env.GITHUB_OUTPUT && !dryRun) await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: 'a' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const safe = error instanceof SheetSyncError || error instanceof PublicationDataError;
    console.error(safe ? error.message : 'Publication sync failed. The saved website data was not replaced.');
    process.exitCode = 1;
  });
}

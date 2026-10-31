import { readFile, writeFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, rowsToPublications, normalizeSheetHeader } from './sheet-publications.mjs';
import { fetchPublicSheetRows, SheetSyncError } from './google-sheets.mjs';
import { validatePublicationData, PublicationDataError } from './publications.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function publicationSnapshot(rows, previous, today = new Date().toISOString().slice(0, 10)) {
  const publications = rowsToPublications(rows);
  const headers = new Set(rows[0].map(normalizeSheetHeader));
  const hasDate = headers.has('date') || headers.has('publication_date');
  const hasNote = headers.has('preprint_note');
  const old = validatePublicationData(previous);
  const byDoi = new Map(old.publications.filter(p => p.doi).map(p => [p.doi.toLowerCase(), p]));
  const byId = new Map(old.publications.map(p => [p.id, p]));
  const byPreprintDoi = new Map(old.publications.filter(p => p.preprint).map(p => [p.preprint.doi.toLowerCase(), p]));
  for (const paper of publications) {
    const prior = (paper.doi ? byDoi.get(paper.doi.toLowerCase()) : byId.get(paper.id))
      || (paper.preprint ? byPreprintDoi.get(paper.preprint.doi.toLowerCase()) : null);
    if (!prior) continue;
    if (!hasDate && ['published', 'preprint'].includes(paper.status) && paper.doi && paper.doi?.toLowerCase() === prior.doi?.toLowerCase() && paper.year === prior.year && prior.date) paper.date = prior.date;
    if (!hasNote && paper.preprint && paper.preprint.doi.toLowerCase() === prior.preprint?.doi.toLowerCase()) paper.preprint.note = prior.preprint.note;
  }
  const unchanged = JSON.stringify(publications) === JSON.stringify(old.publications);
  return validatePublicationData({ schemaVersion: 1, updatedAt: unchanged ? old.updatedAt : today, publications });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvIndex = args.indexOf('--csv');
  if (args.some(a => a.startsWith('--') && !['--csv', '--dry-run'].includes(a)) || (csvIndex !== -1 && !args[csvIndex + 1])) {
    throw new SheetSyncError('Usage: node scripts/sync-publications.mjs [--csv path] [--dry-run]');
  }
  const rows = csvIndex !== -1 ? parseCsv(await readFile(path.resolve(args[csvIndex + 1]), 'utf8'))
    : await fetchPublicSheetRows({ spreadsheetId: process.env.GOOGLE_SHEET_ID, credentialsJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON, tab: process.env.GOOGLE_SHEET_TAB || '' });
  const filename = path.join(root, 'content/publications.json');
  const previousText = await readFile(filename, 'utf8');
  const previous = JSON.parse(previousText);
  const snapshot = publicationSnapshot(rows, previous);
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

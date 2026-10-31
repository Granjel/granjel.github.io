import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationSnapshot } from '../scripts/sync-publications.mjs';

const headers = ['id', 'website', 'status', 'title', 'authors', 'journal', 'year', 'paper_doi', 'preprint_doi', 'pdf', 'keywords', 'abstract'];
const record = (overrides = {}) => ({
  id: 'sheet-record', website: 'yes', status: 'published', title: 'Current manuscript title', authors: 'A. Author, B. Author',
  journal: 'Current Ecology', year: '2024', paper_doi: '10.1234/current.1', preprint_doi: '',
  pdf: 'assets/papers/current-paper.pdf', keywords: 'Global change', abstract: '', ...overrides,
});
const rows = (overrides = {}, columns = headers) => [columns, columns.map(key => record(overrides)[key] ?? '')];
const previous = (overrides = {}) => ({
  schemaVersion: 1, updatedAt: '2026-10-29', publications: [{
    id: 'old-record', title: 'Previous manuscript title', authors: 'Previous Author', coFirstAuthor: false,
    status: 'published', year: 2024, date: '2024-06-12', journal: 'Previous Ecology',
    doi: 'https://doi.org/10.1234/current.1', pdf: 'assets/papers/previous-paper.pdf',
    keywords: ['Previous keyword'], abstract: 'Previous abstract must not overwrite the Sheet.', preprint: null,
    ...overrides,
  }],
});

test('Sheet metadata wins and clearing an abstract leaves it null', () => {
  const result = publicationSnapshot(rows(), previous(), '2026-10-31');
  const paper = result.publications[0];
  assert.equal(paper.id, 'sheet-record');
  assert.equal(paper.title, 'Current manuscript title');
  assert.equal(paper.authors, 'A. Author, B. Author');
  assert.equal(paper.journal, 'Current Ecology');
  assert.equal(paper.pdf, 'assets/papers/current-paper.pdf');
  assert.deepEqual(paper.keywords, ['Global change']);
  assert.equal(paper.abstract, null);
  assert.equal(result.updatedAt, '2026-10-31');
});

test('an absent publication date column preserves an approved date by DOI and year after an ID change', () => {
  const result = publicationSnapshot(rows(), previous(), '2026-10-31');
  assert.equal(result.publications[0].date, '2024-06-12');
  assert.equal(result.publications[0].id, 'sheet-record');
});

test('date preservation treats equivalent DOI casing as the same identity', () => {
  const result = publicationSnapshot(rows({ paper_doi: '10.1234/CURRENT.1' }), previous(), '2026-10-31');
  assert.equal(result.publications[0].date, '2024-06-12');
});

test('an explicit blank publication date column clears the approved date', () => {
  const result = publicationSnapshot(rows({ publication_date: '' }, [...headers, 'publication_date']), previous(), '2026-10-31');
  assert.equal(result.publications[0].date, null);
  assert.equal(result.publications[0].year, 2024);
});

test('an old date never follows a different DOI or a different publication year', () => {
  for (const overrides of [
    { id: 'old-record', paper_doi: '10.1234/current.2' },
    { year: '2025' },
  ]) {
    const result = publicationSnapshot(rows(overrides), previous(), '2026-10-31');
    assert.equal(result.publications[0].date, null);
  }
});

test('re-importing identical Sheet content retains updatedAt and does not manufacture a change', () => {
  const first = publicationSnapshot(rows(), previous(), '2026-10-30');
  const second = publicationSnapshot(rows(), first, '2026-10-31');
  assert.deepEqual(second, first);
  assert.equal(second.updatedAt, '2026-10-30');
});

test('approved preprint version notes follow the companion DOI when IDs change', () => {
  const old = previous({
    status: 'under-review', year: null, date: null, journal: null, doi: null, pdf: null,
    preprint: { title: 'Historical preprint title', year: 2022, doi: 'https://doi.org/10.1234/preprint.1', pdf: null, note: 'The current manuscript has been substantially revised since this preprint.' },
  });
  const result = publicationSnapshot(rows({
    status: 'under review', paper_doi: '', preprint_doi: '10.1234/preprint.1', abstract: 'Current revised manuscript abstract.',
  }), old, '2026-10-31');
  const paper = result.publications[0];
  assert.equal(paper.id, 'sheet-record');
  assert.equal(paper.title, 'Current manuscript title');
  assert.equal(paper.abstract, 'Current revised manuscript abstract.');
  assert.equal(paper.preprint.doi, 'https://doi.org/10.1234/preprint.1');
  assert.equal(paper.preprint.note, old.publications[0].preprint.note);
});

test('a preprint version note is not copied to a different preprint DOI', () => {
  const old = previous({
    status: 'under-review', year: null, date: null, journal: null, doi: null, pdf: null,
    preprint: { doi: 'https://doi.org/10.1234/preprint.1', note: 'A note about the previous preprint version.' },
  });
  const result = publicationSnapshot(rows({ id: 'old-record', status: 'under review', paper_doi: '', preprint_doi: '10.1234/preprint.2' }), old, '2026-10-31');
  assert.equal(result.publications[0].preprint.note, null);
});

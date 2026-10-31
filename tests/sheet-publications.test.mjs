import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPublicationHeaders, normalizeSheetHeader, parseCsv, PUBLIC_SHEET_COLUMNS, rowsToPublications } from '../scripts/sheet-publications.mjs';

const headers = ['id', 'website', 'status', 'title', 'authors', 'role', 'journal', 'year', 'paper_doi', 'preprint_doi', 'pdf', 'abstract', 'keywords', 'notes'];
const paper = (overrides = {}) => ({
  id: 'synthetic-paper', website: 'yes', status: 'published', title: 'A synthetic paper', authors: 'A. Author, Rodrigo R. Granjel',
  role: 'second', journal: 'Example Ecology', year: '2024', paper_doi: '10.1234/current.1', preprint_doi: '', pdf: '',
  abstract: 'An abstract about *Arabidopsis thaliana*.', keywords: 'Species interactions; Recovery dynamics', notes: 'PRIVATE TRACKER NOTE',
  ...overrides,
});
const matrix = (records, columns = headers) => [columns, ...records.map(record => columns.map(column => record[column] ?? ''))];

test('CSV parser preserves quoted commas, doubled quotes, CRLF and multiline abstracts', () => {
  assert.deepEqual(parseCsv('\uFEFFtitle,abstract\r\n"A, title","Line 1\r\nHe said ""hello""."\r\n'), [
    ['title', 'abstract'], ['A, title', 'Line 1\r\nHe said "hello".'],
  ]);
  assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']]);
  assert.deepEqual(parseCsv(''), []);
});

test('CSV parser rejects malformed quoting without including cell contents in errors', () => {
  for (const value of ['a,"PRIVATE UNCLOSED', 'a,PRIVATE"BAD', 'a,"PRIVATE"suffix']) {
    assert.throws(() => parseCsv(value), error => error.name === 'PublicationDataError' && !error.message.includes('PRIVATE'));
  }
});

test('only explicitly selected rows enter public data and private tracking columns are discarded', () => {
  const [result] = rowsToPublications(matrix([paper(), paper({ id: 'private-row', website: 'no', title: 'PRIVATE TITLE' }), paper({ id: 'unset-row', website: '' })]));
  assert.equal(result.id, 'synthetic-paper');
  assert.equal(result.doi, 'https://doi.org/10.1234/current.1');
  assert.equal(result.coFirstAuthor, false);
  assert.equal(result.abstract, 'An abstract about *Arabidopsis thaliana*.');
  assert.deepEqual(result.keywords, ['Species interactions', 'Recovery dynamics']);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal('notes' in result, false);
});

test('project preparation rows stay hidden, regardless of their visibility flag', () => {
  const rows = ['writing', 'analysis', 'data ready', 'data collection', 'in preparation'].map((status, index) => paper({ id: `draft-${index}`, status, title: '' }));
  assert.deepEqual(rowsToPublications(matrix(rows)), []);
});

test('keywords support comma-separated exports and preserve commas in semicolon-separated phrases', () => {
  const commaKeywords = 'Arabidopsis thaliana, herbivore-induced defences, intraspecific variation, life-history traits, local adaptation, plant–insect interactions, plant–plant signalling, volatile organic compounds (VOCs)';
  const commaResult = rowsToPublications(matrix([paper({ keywords: commaKeywords })]))[0];
  assert.equal(commaResult.keywords.length, 8);
  assert.equal(commaResult.keywords[0], 'Arabidopsis thaliana');
  assert.equal(commaResult.keywords.at(-1), 'Volatile organic compounds');
  const semicolonResult = rowsToPublications(matrix([paper({ keywords: 'Temporal stability, ecosystem function; Recovery dynamics\nGlobal change' })]))[0];
  assert.deepEqual(semicolonResult.keywords, ['Temporal stability, ecosystem function', 'Recovery dynamics', 'Global change']);
});

test('in revision is under review and review journal/year/resources do not leak', () => {
  const result = rowsToPublications(matrix([paper({ status: 'in revision', journal: 'PRIVATE JOURNAL', year: 'PRIVATE YEAR', paper_doi: 'PRIVATE DOI', pdf: 'PRIVATE PDF', preprint_doi: '10.1234/preprint.1' })]))[0];
  assert.equal(result.status, 'under-review');
  for (const key of ['journal', 'year', 'date', 'doi', 'pdf']) assert.equal(result[key], null);
  assert.equal(result.preprint.doi, 'https://doi.org/10.1234/preprint.1');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('a preprint DOI accompanies a published or submitted work without changing its status', () => {
  for (const status of ['published', 'submitted']) {
    const result = rowsToPublications(matrix([paper({ status, preprint_doi: '10.1234/preprint.1' })]))[0];
    assert.equal(result.status, status);
    assert.equal(result.preprint.doi, 'https://doi.org/10.1234/preprint.1');
  }
});

test('standalone preprint status uses main DOI with fallback to preprint DOI and no duplicate link', () => {
  for (const paperDoi of ['', '10.1234/preprint.1']) {
    const result = rowsToPublications(matrix([paper({ status: 'preprint', paper_doi: paperDoi, preprint_doi: '10.1234/preprint.1' })]))[0];
    assert.equal(result.status, 'preprint');
    assert.equal(result.doi, 'https://doi.org/10.1234/preprint.1');
    assert.equal(result.preprint, null);
  }
});

test('a companion DOI identical to the main DOI is not rendered twice', () => {
  const result = rowsToPublications(matrix([paper({ preprint_doi: 'https://doi.org/10.1234/CURRENT.1' })]))[0];
  assert.equal(result.preprint, null);
});

test('accepted papers do not acquire speculative dates or publication years', () => {
  const result = rowsToPublications(matrix([paper({ status: 'accepted', publication_date: '2024-01-02' })], [...headers, 'publication_date']))[0];
  assert.equal(result.year, null);
  assert.equal(result.date, null);
  assert.equal(result.journal, 'Example Ecology');
});

test('unpublished row order is retained and blanks at the end of Sheets are ignored', () => {
  const rows = matrix([paper({ id: 'z-first', status: 'under review' }), paper({ id: 'a-second', status: 'submitted' })]);
  rows.push([], Array(headers.length).fill(''));
  assert.deepEqual(rowsToPublications(rows).map(record => record.id), ['z-first', 'a-second']);
});

test('checkbox values and explicit equal-contribution metadata work without guessing from author position', () => {
  const columns = [...headers, 'co_first_author'];
  const selected = rowsToPublications(matrix([
    paper({ id: 'included-checkbox', website: true, co_first_author: true }),
    paper({ id: 'excluded-checkbox', website: false }),
    paper({ id: 'not-co-first', co_first_author: false, paper_doi: '10.1234/current.2' }),
  ], columns));
  assert.deepEqual(selected.map(record => [record.id, record.coFirstAuthor]), [['included-checkbox', true], ['not-co-first', false]]);
});

test('missing/ambiguous headers fail safely rather than publishing unintended columns', () => {
  assert.throws(() => rowsToPublications([['title', 'authors', 'status']]), /missing website/);
  assert.throws(() => rowsToPublications([['website', 'show_on_website', 'title', 'authors', 'status']]), /only one website/);
  assert.throws(() => rowsToPublications([['website', 'title', 'TITLE', 'authors', 'status']]), /only one title/);
});

test('tab discovery recognizes only a unique publication header and requests public columns', () => {
  assert.equal(normalizeSheetHeader('\uFEFF Show on website '), 'show_on_website');
  assert.equal(hasPublicationHeaders(['Title', 'Authors', 'Status', 'Show on website']), true);
  assert.equal(hasPublicationHeaders(['title', 'authors', 'status', 'website', 'show_on_website']), false);
  assert.equal(hasPublicationHeaders(['private notes', 'contact', 'status']), false);
  for (const field of ['notes', 'correspondence', 'prior_rejections_in_order', 'my_funding', 'preprint']) assert.equal(PUBLIC_SHEET_COLUMNS.includes(field), false);
});

test('invalid public data reports the original Sheet row, never cell contents', () => {
  const rows = matrix([paper({ website: 'no', id: 'private' }), paper({ paper_doi: 'PRIVATE INVALID DOI' })]);
  assert.throws(() => rowsToPublications(rows), error => /Sheet row 3 DOI/.test(error.message) && !error.message.includes('PRIVATE'));
  assert.throws(() => rowsToPublications(matrix([paper({ website: 'PRIVATE INVALID FLAG' })])), error => /Sheet row 2 website/.test(error.message) && !error.message.includes('PRIVATE'));
});

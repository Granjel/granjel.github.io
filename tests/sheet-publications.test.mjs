import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPublicationHeaders, normalizeSheetHeader, parseCsv, PUBLIC_SHEET_COLUMNS, rowsToPublications } from '../scripts/sheet-publications.mjs';

const headers = ['id', 'website', 'status', 'title', 'authors', 'role', 'journal', 'year', 'paper_doi', 'preprint_doi', 'pdf', 'abstract', 'keywords', 'notes', 'code_doi', 'git_repo_link', 'data_doi'];
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

test('website selection includes every preparation stage without author-position restrictions', () => {
  const stages = ['writing', 'analysis', 'data ready', 'data collection', 'in preparation'];
  const rows = stages.flatMap((status, index) => [
    paper({ id: 'selected-' + index, status, title: 'Synthetic project ' + index, authors: 'A. Author, Rodrigo R. Granjel, B. Author', role: 'second', journal: 'PRIVATE TARGET JOURNAL', year: 'PRIVATE YEAR', publication_date: 'PRIVATE DATE', paper_doi: 'PRIVATE MAIN DOI', pdf: 'PRIVATE MANUSCRIPT', code_doi: '10.1234/code.' + index, data_doi: '10.1234/data.' + index, preprint_doi: '10.1234/preprint.' + index }),
    paper({ id: 'excluded-' + index, status, website: 'no', title: 'PRIVATE UNSELECTED TITLE', authors: '' }),
    paper({ id: 'unset-' + index, status, website: '', title: 'PRIVATE UNSET TITLE', authors: '' }),
  ]);
  const result = rowsToPublications(matrix(rows, [...headers, 'publication_date']));
  assert.deepEqual(result.map(record => record.id), stages.map((_, index) => 'selected-' + index), 'selected projects retain Sheet row order');
  for (const [index, record] of result.entries()) {
    assert.equal(record.status, 'in-preparation');
    assert.equal(record.coFirstAuthor, false, 'middle authorship needs no equal-contribution claim');
    for (const field of ['journal', 'year', 'date', 'doi', 'pdf']) assert.equal(record[field], null, field + ': preparation metadata stays private');
    assert.equal(record.abstract, 'An abstract about *Arabidopsis thaliana*.');
    assert.equal(record.code, 'https://doi.org/10.1234/code.' + index);
    assert.equal(record.data, 'https://doi.org/10.1234/data.' + index);
    assert.equal(record.preprint.doi, 'https://doi.org/10.1234/preprint.' + index);
  }
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false, 'private tracker fields and unchecked rows never enter public data');
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

test('Code and Data retain their explicit DOI even when both are identical', () => {
  const result = rowsToPublications(matrix([paper({
    code_doi: '10.1234/shared-archive', git_repo_link: 'https://github.com/example/project', data_doi: '10.1234/shared-archive',
  })]))[0];
  assert.equal(result.code, 'https://doi.org/10.1234/shared-archive');
  assert.equal(result.data, 'https://doi.org/10.1234/shared-archive');
});

test('blank code_doi never publishes a private GitHub repository fallback', () => {
  const result = rowsToPublications(matrix([paper({ code_doi: ' ', git_repo_link: 'https://github.com/example/PRIVATE_REPOSITORY' })]))[0];
  assert.equal(result.code, null);
  assert.equal(result.data, null);
  assert.equal(JSON.stringify(result).includes('PRIVATE_REPOSITORY'), false);
  assert.equal(PUBLIC_SHEET_COLUMNS.includes('git_repo_link'), false);
  const empty = rowsToPublications(matrix([paper()]))[0];
  assert.equal(empty.code, null);
  assert.equal(empty.data, null);
});

test('Code accepts an explicit HTTPS link only when code_doi is filled', () => {
  const result = rowsToPublications(matrix([paper({
    code_doi: 'https://github.com/example/public-code', git_repo_link: 'https://github.com/example/PRIVATE_REPOSITORY',
  })]))[0];
  assert.equal(result.code, 'https://github.com/example/public-code');
  assert.equal(JSON.stringify(result).includes('PRIVATE_REPOSITORY'), false);
});

test('explicit artifact links survive review-status redaction while private rows and tracking flags stay out', () => {
  const columns = [...headers, 'code_available', 'data_available'];
  const result = rowsToPublications(matrix([
    paper({ status: 'under review', journal: 'PRIVATE JOURNAL', code_doi: '10.1234/code', data_doi: '10.1234/data', code_available: 'PRIVATE FLAG', data_available: 'PRIVATE FLAG' }),
    paper({ id: 'private-row', website: 'no', code_doi: 'PRIVATE CODE LINK', data_doi: 'PRIVATE DATA LINK' }),
  ], columns));
  assert.equal(result.length, 1);
  assert.equal(result[0].journal, null);
  assert.equal(result[0].code, 'https://doi.org/10.1234/code');
  assert.equal(result[0].data, 'https://doi.org/10.1234/data');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  for (const field of ['code_doi', 'data_doi']) assert.equal(PUBLIC_SHEET_COLUMNS.includes(field), true);
  for (const field of ['code_available', 'data_available', 'git_repo_link']) assert.equal(PUBLIC_SHEET_COLUMNS.includes(field), false);
});

test('invalid selected artifact links report their Sheet row without exposing the link', () => {
  assert.throws(() => rowsToPublications(matrix([paper({ code_doi: 'javascript:PRIVATE_CODE' })])), error => /Sheet row 2/i.test(error.message) && !error.message.includes('PRIVATE_CODE'));
  assert.throws(() => rowsToPublications(matrix([paper({ data_doi: 'javascript:PRIVATE_DATA' })])), error => /Sheet row 2/i.test(error.message) && !error.message.includes('PRIVATE_DATA'));
});
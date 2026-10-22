import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationData } from '../scripts/publications.mjs';
import { comparePublications, isOngoing, publicationGroup, normalizeKeyword, normalizeKeywords, normalizePublicationStatus, isPreparationEligible } from '../assets/publication-utils.js';

const base = {
  schemaVersion: 1, updatedAt: '2026-10-22',
  publications: [{
    id: 'paper-one', title: 'Microbial communities', authors: 'A. Researcher; B. Researcher',
    year: 2024, status: 'published', journal: 'A journal',
    doi: 'https://doi.org/10.1234/EXAMPLE', pdf: 'assets/papers/example.pdf',
    keywords: ['Ecology'], abstract: null,
  }],
};
const change = patch => ({ ...base, publications: [{ ...base.publications[0], ...patch }] });
const sortable = (id, status, year, date = null) => ({ id, title: id, status, year, date });

test('normalizes public metadata and exports only allowed fields', () => {
  const result = validatePublicationData(change({
    doi: 'doi:10.1234/example', pdf: 'example.pdf', privateNotes: 'PRIVATE',
    keywords: [' co-existence ', 'COEXISTENCE', 'Ecology'],
  }));
  const paper = result.publications[0];
  assert.equal(paper.doi, 'https://doi.org/10.1234/example');
  assert.equal(paper.pdf, 'assets/papers/example.pdf');
  assert.deepEqual(paper.keywords, ['Coexistence', 'Ecology']);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(Object.keys(paper), ['id', 'title', 'authors', 'coFirstAuthor', 'year', 'date', 'status', 'journal', 'doi', 'pdf', 'keywords', 'abstract']);
  assert.deepEqual(validatePublicationData(result), result);
});

test('rejects malformed fields, unsafe URLs, and PDF traversal without echoing source values', () => {
  for (const patch of [
    { title: '' }, { title: 2 }, { title: 'x'.repeat(2001) }, { authors: 'Secret\u0000text' },
    { year: '2024-ish' }, { year: 9999 }, { status: 'SECRET STATUS' }, { id: '../secret' },
    { doi: 'https://example.com/private' }, { doi: 'javascript:alert(1)' },
    { doi: 'https://doi.org/10.1234/example?token=SECRET' },
    { doi: 'https://user:SECRET@doi.org/10.1234/example' },
    { doi: 'https://doi.org:444/10.1234/example' }, { doi: 'https://doi.org/10.1234/example#SECRET' },
    { doi: 'https://doi.org/10.1234/%3Cscript%3E' }, { doi: 'https://doi.org/10.1234/%0Asecret' },
    { pdf: '../private.pdf' }, { pdf: 'assets/papers/../../private.pdf' },
    { pdf: 'https://example.com/paper.pdf' }, { pdf: 'assets/papers/%2e%2e/private.pdf' },
    { pdf: 'assets/papers/evil.pdf?token=SECRET' }, { pdf: 'assets/papers/evil.svg' },
    { pdf: 'assets\\papers\\private.pdf' }, { pdf: '" onload="SECRET.pdf' },
    { keywords: 'Ecology' }, { keywords: ['Ecology', 2] }, { keywords: Array(51).fill('Ecology') },
    { date: '2024-02-30' }, { date: '2023-10-01' },
  ]) {
    assert.throws(() => validatePublicationData(change(patch)), error => {
      assert.equal(error.message.includes('SECRET'), false);
      assert.equal(error.message.includes('example.com'), false);
      return true;
    });
  }
});

test('requires a valid snapshot shape and real dates', () => {
  for (const data of [null, [], { ...base, schemaVersion: 2 }, { ...base, publications: {} },
    { ...base, publications: [null] }, { ...base, publications: [[]] },
    { ...base, publications: Array(5001).fill(base.publications[0]) },
    { ...base, updatedAt: '2026-02-30' }, { ...base, updatedAt: '2026-1-2' }]) {
    assert.throws(() => validatePublicationData(data));
  }
  const paper = validatePublicationData(change({ year: null, date: '2024-02-29' })).publications[0];
  assert.equal(paper.year, 2024);
  assert.equal(paper.date, '2024-02-29');
  assert.equal(validatePublicationData(change({ year: null, date: null })).publications[0].year, null);
});

test('discards prototype and unknown keys instead of propagating them', () => {
  const extra = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"privateNotes":"PRIVATE"}');
  const paper = validatePublicationData(change(extra)).publications[0];
  assert.equal(Object.hasOwn(paper, '__proto__'), false);
  assert.equal(Object.hasOwn(paper, 'constructor'), false);
  assert.equal(Object.hasOwn(paper, 'privateNotes'), false);
  assert.equal({}.polluted, undefined);
  const inherited = Object.create(base.publications[0]);
  assert.throws(() => validatePublicationData({ ...base, publications: [inherited] }), /expected an object/);
});

test('generated IDs are deterministic without exposing the title', () => {
  const input = change({ id: null });
  const id = validatePublicationData(input).publications[0].id;
  assert.match(id, /^paper-[a-f0-9]{16}$/);
  assert.equal(id, validatePublicationData(input).publications[0].id);
  assert.notEqual(id, validatePublicationData(change({ id: null, doi: '10.1234/another' })).publications[0].id);
});

test('explicit co-first metadata remains a boolean', () => {
  assert.equal(validatePublicationData(base).publications[0].coFirstAuthor, false);
  assert.equal(validatePublicationData(change({ coFirstAuthor: true })).publications[0].coFirstAuthor, true);
  for (const value of ['true', 'second', 'yes', 1, { first: true }]) {
    assert.throws(() => validatePublicationData(change({ coFirstAuthor: value })), /coFirstAuthor/);
  }
});

test('rejects duplicate DOI and IDs including case-insensitive DOI duplicates', () => {
  assert.throws(() => validatePublicationData({ ...base, publications: [...base.publications, { ...base.publications[0], id: 'second', doi: '10.1234/example' }] }), /DOI: duplicates/);
  assert.throws(() => validatePublicationData({ ...base, publications: [...base.publications, { ...base.publications[0], doi: '10.1234/other' }] }), /id: duplicates/);
});

test('keeps publication stages and preprints distinct', () => {
  const aliases = [
    ['in revision', 'under-review'], ['writing', 'in-preparation'], ['analysis', 'in-preparation'],
    ['data ready', 'in-preparation'], ['data collection', 'in-preparation'], ['accepted', 'accepted'], ['preprint', 'preprint'],
  ];
  for (const [source, expected] of aliases) {
    assert.equal(normalizePublicationStatus(source), expected);
    assert.equal(validatePublicationData(change({ status: source })).publications[0].status, expected);
  }
  assert.equal(publicationGroup({ status: 'accepted' }), 'published');
  assert.equal(publicationGroup({ status: 'preprint' }), 'preprints');
  assert.equal(isOngoing({ status: 'accepted' }), false);
});

test('groups keyword spelling variants without conflating different ecological concepts', () => {
  assert.deepEqual(normalizeKeywords([
    ' co-existence ', 'COEXISTENCE', 'Species  interactions', 'species interaction',
    'biotic interactions', 'Plant-herbivore interactions', 'plant–herbivore interaction',
    'Stabilising mechanisms', 'stabilizing mechanism', 'eDNA', 'DNA sequencing',
  ]), ['Coexistence', 'Species interactions', 'Biotic interactions', 'Plant–herbivore interactions', 'Stabilizing mechanisms', 'eDNA', 'DNA sequencing']);
  assert.equal(normalizeKeyword(' eDNA   sequencing '), 'eDNA sequencing');
  assert.notEqual(normalizeKeyword('Nitrogen enrichment'), normalizeKeyword('Nitrogen fixation'));
});

test('groups exact abbreviations and plurals used by publication keywords without broadening concepts', () => {
  assert.deepEqual(normalizeKeywords([
    'DOC', 'dissolved organic carbon', 'VOC', 'VOCs', 'volatile organic compound',
    'Volatile organic compounds', 'volatile organic compounds (VOCs)', 'grassland', 'Grasslands', 'Coexistence', 'Multispecies coexistence',
  ]), ['Dissolved organic carbon', 'Volatile organic compounds', 'Grasslands', 'Coexistence', 'Multispecies coexistence']);
  assert.notEqual(normalizeKeyword('Structural stability'), normalizeKeyword('Ecosystem stability'));
  assert.notEqual(normalizeKeyword('Fungal pathogens'), normalizeKeyword('Foliar fungal pathogens'));
});

test('preserves observed geographical names and scientific keyword hyphenation', () => {
  const normalized = normalizeKeywords([
    'Inner Mongolian Plateau', 'Qinghai-Tibetan Plateau', 'plant–insect interactions',
    'plant-plant interactions', 'plant–plant signalling', 'herbivore-induced defences',
    'higher-order interactions', 'life-history traits', 'INNER MONGOLIAN PLATEAU',
  ]);
  assert.deepEqual(normalized, [
    'Inner Mongolian Plateau', 'Qinghai-Tibetan Plateau', 'Plant–insect interactions',
    'Plant–plant interactions', 'Plant–plant signalling', 'Herbivore-induced defences',
    'Higher-order interactions', 'Life-history traits',
  ]);
  assert.deepEqual(normalizeKeywords(normalized), normalized);
});

test('default order preserves preparation source order and sorts other groups by recency', () => {
  const papers = [
    sortable('published-new', 'published', 2026), sortable('preprint', 'preprint', 2025),
    sortable('review-old', 'under-review', 2023), sortable('published-old', 'published', 2024),
    sortable('submission', 'submitted', null), sortable('review-new', 'under-review', 2026, '2026-10-20'),
    sortable('preparation-old', 'in-preparation', 2024), sortable('preparation-new', 'in-preparation', 2026),
    sortable('preparation-undated', 'in-preparation', null),
    sortable('accepted-recent', 'accepted', 2026, '2026-10-21'),
  ];
  assert.deepEqual([...papers].sort(comparePublications).map((paper) => paper.id), ['preparation-old', 'preparation-new', 'preparation-undated', 'submission', 'review-new', 'review-old', 'preprint', 'accepted-recent', 'published-new', 'published-old']);
  assert.equal(isOngoing(papers[0]), false);
  assert.equal(isOngoing(papers[2]), true);
  assert.equal(isOngoing(papers[1]), false);
  assert.equal(isOngoing(papers[6]), false);
  assert.equal(papers[4].year, null);
  assert.deepEqual(papers.map(publicationGroup), ['published', 'preprints', 'submitted', 'published', 'submitted', 'submitted', 'preparation', 'preparation', 'preparation', 'published']);
});

test('authorship eligibility requires first, last, or explicit co-first authorship without inferring equality', () => {
  const owner = 'Rodrigo R. Granjel';
  assert.equal(isPreparationEligible({ authors: `${owner}, A. Researcher, B. Researcher` }), true);
  assert.equal(isPreparationEligible({ authors: `A. Researcher, B. Researcher, ${owner}` }), true);
  const second = { authors: `A. Researcher, ${owner}, B. Researcher` };
  assert.equal(isPreparationEligible(second), false);
  assert.equal(isPreparationEligible({ ...second, role: 'first' }), false);
  assert.equal(isPreparationEligible({ ...second, coFirstAuthor: true }), true);
  assert.equal(isPreparationEligible({ ...second, coFirstAuthor: 'true' }), false);
  assert.equal(isPreparationEligible({ authors: 'A. Researcher, B. Researcher', coFirstAuthor: true }), false);
  assert.equal(isPreparationEligible({ authors: `A. Researcher, ${owner}, and 100 additional coauthors` }), false);
  assert.equal(isPreparationEligible({ authors: 'Other, A.; Granjel, Rodrigo R.' }), true);
  assert.equal(isPreparationEligible({ authors: 'Granjel, Rodrigo R.' }), true);
  assert.equal(isPreparationEligible({ authors: 'A. Researcher, Rodrigo R. Granjel-Smith' }), false);
});

test('default undated and equal-date ties retain source order instead of alphabetizing', () => {
  const papers = [
    sortable('z-submitted', 'submitted', null), sortable('a-submitted', 'under-review', null),
    sortable('z-published', 'published', 2026), sortable('a-published', 'published', 2026),
    sortable('older-published', 'published', 2024),
  ];
  assert.deepEqual([...papers].sort(comparePublications).map(paper => paper.id), papers.map(paper => paper.id));
});

test('chronological ordering includes submitted dates and handles stable ties without fabricated years', () => {
  const papers = [
    sortable('undated-other', 'published', null), sortable('recent-published', 'published', 2026, '2026-10-20'),
    sortable('recent-submitted', 'submitted', 2026, '2026-10-21'), sortable('undated-review', 'under-review', null),
    sortable('b-title', 'preprint', 2025), sortable('a-title', 'published', 2025),
  ];
  assert.deepEqual([...papers].sort((a, b) => comparePublications(a, b, 'newest')).map((paper) => paper.id), ['undated-review', 'recent-submitted', 'recent-published', 'a-title', 'b-title', 'undated-other']);
  assert.deepEqual([...papers].reverse().sort((a, b) => comparePublications(a, b, 'newest')), [...papers].sort((a, b) => comparePublications(a, b, 'newest')));
});

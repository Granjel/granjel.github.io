import { createHash } from 'node:crypto';
import { normalizeKeywords, normalizePublicationStatus } from '../assets/publication-utils.js';

const STATUSES = new Set(['published', 'accepted', 'preprint', 'submitted', 'under-review', 'in-preparation']);
const MAX_PUBLICATIONS = 5000;
// Validation messages identify the record/field, never its private cell contents.
export class PublicationDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublicationDataError';
  }
}

function fail(location, message) {
  throw new PublicationDataError(`${location}: ${message}`);
}

function text(value, location, { optional = false, max = 20000 } = {}) {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string') fail(location, 'expected text.');
  const result = value.trim();
  if (!result) {
    if (optional) return null;
    fail(location, 'is required.');
  }
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) {
    fail(location, 'contains unsupported characters or exceeds the field length limit.');
  }
  return result;
}

function normalizeDoi(value, location) {
  const input = text(value, location, { optional: true, max: 2048 });
  if (input === null) return null;
  let doi = input.replace(/^doi:\s*/i, '');
  if (/^https?:\/\//i.test(doi)) {
    let url;
    try { url = new URL(doi); } catch { fail(location, 'must be a DOI or a doi.org URL.'); }
    if (!['doi.org', 'dx.doi.org'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash) {
      fail(location, 'must use doi.org without credentials, a query, or a fragment.');
    }
    try { doi = decodeURIComponent(url.pathname.slice(1)); } catch { fail(location, 'has invalid encoding.'); }
  }
  if (!/^10\.\d{4,9}\/[^\s<>"'\\]+$/i.test(doi) || /[?#]/.test(doi)) {
    fail(location, 'must be a valid DOI.');
  }
  return `https://doi.org/${doi}`;
}

function normalizePdf(value, location) {
  const input = text(value, location, { optional: true, max: 255 });
  if (input === null) return null;
  // Keep PDFs inside the public paper directory; never accept URLs or traversal.
  const filename = input.replace(/^assets\/papers\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 _().-]*\.pdf$/i.test(filename) || filename.includes('..')) {
    fail(location, 'must name a local PDF in assets/papers (no URLs or parent paths).');
  }
  return `assets/papers/${filename}`;
}

function normalizeStatus(value, location) {
  return normalizePublicationStatus(text(value, location, { max: 30 }));
}

function normalizeDate(value, location) {
  const input = text(value, location, { optional: true, max: 10 });
  if (input === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input) || Number.isNaN(Date.parse(input)) || new Date(input).toISOString().slice(0, 10) !== input) {
    fail(location, 'must be a valid date in YYYY-MM-DD format.');
  }
  return input;
}

function normalizeCoFirstAuthor(value, location) {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  fail(location, 'must be true, false, or omitted.');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function normalizePublication(record, index) {
  const at = `Publication ${index + 1}`;
  if (!isRecord(record)) fail(at, 'expected an object.');
  const title = text(record.title, `${at} title`, { max: 2000 });
  const authors = text(record.authors, `${at} authors`);
  const coFirstAuthor = normalizeCoFirstAuthor(record.coFirstAuthor, `${at} coFirstAuthor`);
  const status = normalizeStatus(record.status, `${at} status`);
  if (!STATUSES.has(status)) fail(`${at} status`, 'use published, accepted, preprint, submitted, under-review, or in-preparation.');
  let year = record.year;
  if (year == null || year === '') year = null;
  else {
    if (typeof year === 'string' && /^\d{4}$/.test(year.trim())) year = Number(year.trim());
    if (!Number.isInteger(year) || year < 1800 || year > new Date().getUTCFullYear() + 2) {
      fail(`${at} year`, 'must be a four-digit publication year or blank.');
    }
  }
  const date = normalizeDate(record.date, `${at} date`);
  if (date) {
    const dateYear = Number(date.slice(0, 4));
    if (dateYear < 1800 || dateYear > new Date().getUTCFullYear() + 2 || (year !== null && year !== dateYear)) {
      fail(`${at} date`, 'must agree with the year and use a supported publication year.');
    }
    if (year === null) year = dateYear;
  }
  const doi = normalizeDoi(record.doi, `${at} DOI`);
  const generatedId = `paper-${createHash('sha256').update((doi || title).toLowerCase()).digest('hex').slice(0, 16)}`;
  const id = record.id == null || record.id === '' ? generatedId : text(record.id, `${at} id`, { max: 100 });
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) fail(`${at} id`, 'use only letters, numbers, hyphens, and underscores.');
  if (record.keywords != null && !Array.isArray(record.keywords)) fail(`${at} keywords`, 'expected an array.');
  if (record.keywords?.length > 50) fail(`${at} keywords`, 'a maximum of 50 keywords is supported.');
  const keywords = normalizeKeywords((record.keywords || []).map((keyword) => text(keyword, `${at} keyword`, { max: 100 })));
  // Explicit allowlist: private notes, source identifiers, and unknown fields are discarded.
  return {
    id, title, authors, coFirstAuthor, year, date, status,
    journal: text(record.journal, `${at} journal`, { optional: true, max: 1000 }),
    doi,
    pdf: normalizePdf(record.pdf, `${at} PDF`),
    keywords,
    abstract: text(record.abstract, `${at} abstract`, { optional: true }),
  };
}

export function validatePublicationData(data) {
  if (!isRecord(data) || data.schemaVersion !== 1) fail('Publication data', 'schemaVersion must be 1.');
  const updatedAt = data.updatedAt;
  if (typeof updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(updatedAt) || Number.isNaN(Date.parse(updatedAt)) || new Date(updatedAt).toISOString().slice(0, 10) !== updatedAt) {
    fail('Publication data updatedAt', 'must be a valid date in YYYY-MM-DD format.');
  }
  if (!Array.isArray(data.publications) || data.publications.length > MAX_PUBLICATIONS) {
    fail('Publication data', `expected an array with at most ${MAX_PUBLICATIONS} publications.`);
  }
  const publications = data.publications.map(normalizePublication);
  const ids = new Set();
  const dois = new Set();
  for (let index = 0; index < publications.length; index += 1) {
    const record = publications[index];
    const doiKey = record.doi?.toLowerCase();
    if (ids.has(record.id)) fail(`Publication ${index + 1} id`, 'duplicates an earlier record.');
    if (doiKey && dois.has(doiKey)) fail(`Publication ${index + 1} DOI`, 'duplicates an earlier record.');
    ids.add(record.id);
    if (doiKey) dois.add(doiKey);
  }
  return { schemaVersion: 1, updatedAt, publications };
}


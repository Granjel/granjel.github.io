import { normalizePublicationStatus } from '../assets/publication-utils.js';
import { PublicationDataError, validatePublicationData } from './publications.mjs';

const PUBLIC_STATUSES = new Set(['published', 'accepted', 'preprint', 'submitted', 'under-review']);
const TRUE_VALUES = new Set(['yes', 'true', '1']);
const FALSE_VALUES = new Set(['', 'no', 'false', '0']);
const CO_FIRST_ROLES = new Set(['co-first', 'joint-first', 'equal-first', 'second-equal', 'second-equal-contribution', 'second-co-first']);

export const PUBLIC_SHEET_COLUMNS = Object.freeze([
  'website', 'show_on_website', 'id', 'status', 'title', 'authors', 'role', 'co_first_author', 'equal_first_author',
  'year', 'date', 'publication_date', 'journal', 'paper_doi', 'doi', 'pdf', 'keywords', 'abstract', 'preprint_doi', 'code_doi', 'git_repo_link', 'data_doi',
]);

function fail(location, message) {
  throw new PublicationDataError(`${location}: ${message}`);
}

/** Parse an RFC 4180 CSV export, including quoted newlines and doubled quotes. */
export function parseCsv(input) {
  if (typeof input !== 'string') fail('CSV data', 'expected text.');
  const source = input.replace(/^\uFEFF/u, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  const endField = () => { row.push(field); field = ''; closedQuote = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
      continue;
    }

    if (character === ',') endField();
    else if (character === '\r' || character === '\n') {
      endRow();
      if (character === '\r' && source[index + 1] === '\n') index += 1;
    } else if (closedQuote) fail(`CSV row ${rows.length + 1}`, 'unexpected text after a closing quote.');
    else if (character === '"') {
      if (field.length) fail(`CSV row ${rows.length + 1}`, 'a quote must begin a field.');
      quoted = true;
    } else field += character;
  }
  if (quoted) fail(`CSV row ${rows.length + 1}`, 'a quoted field is not closed.');
  if (row.length || field.length || closedQuote) endRow();
  return rows;
}

function scalar(value, location) {
  if (value == null) return '';
  if (!['string', 'number', 'boolean'].includes(typeof value)) fail(location, 'expected a scalar cell value.');
  return String(value).trim();
}

function flag(value, location) {
  const key = scalar(value, location).toLowerCase();
  if (TRUE_VALUES.has(key)) return true;
  if (FALSE_VALUES.has(key)) return false;
  fail(location, 'use yes/no, true/false, or a checkbox.');
}

export function normalizeSheetHeader(value, column = 1) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') fail(`Sheet header column ${column}`, 'expected text.');
  return value.replace(/^\uFEFF/u, '').normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/gu, '_');
}

export function hasPublicationHeaders(headers) {
  if (!Array.isArray(headers)) return false;
  let keys;
  try { keys = headers.map((value, index) => normalizeSheetHeader(value, index + 1)); }
  catch { return false; }
  return [['website', 'show_on_website'], ['status'], ['title'], ['authors']]
    .every(names => keys.filter(key => names.includes(key)).length === 1);
}

function doiKey(value) {
  const source = value.replace(/^doi:\s*/iu, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '');
  try { return decodeURIComponent(source).toLowerCase(); } catch { return source.toLowerCase(); }
}

/**
 * Convert a Sheets values matrix (first row = headers) into public records.
 * The website/show_on_website flag is mandatory and defaults to excluded per row.
 * Only named public fields are read; private tracking columns never enter output.
 */
export function rowsToPublications(rows, { updatedAt = new Date().toISOString().slice(0, 10) } = {}) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) fail('Sheet data', 'expected a header row.');
  if (rows.length > 50001) fail('Sheet data', 'exceeds the supported row count.');
  const header = rows[0].map((value, index) => normalizeSheetHeader(value, index + 1));
  const column = (names, { required = false } = {}) => {
    const indexes = header.flatMap((key, index) => names.includes(key) ? [index] : []);
    if (indexes.length > 1) fail('Sheet header', `use only one ${names[0]} column.`);
    if (!indexes.length && required) fail('Sheet header', `missing ${names[0]} column.`);
    return indexes[0] ?? -1;
  };
  const columns = {
    visible: column(['website', 'show_on_website'], { required: true }),
    id: column(['id']),
    status: column(['status'], { required: true }),
    title: column(['title'], { required: true }),
    authors: column(['authors'], { required: true }),
    role: column(['role']),
    coFirst: column(['co_first_author', 'equal_first_author']),
    year: column(['year']),
    date: column(['publication_date', 'date']),
    journal: column(['journal']),
    doi: column(['paper_doi', 'doi']),
    pdf: column(['pdf']),
    keywords: column(['keywords']),
    abstract: column(['abstract']),
    preprintDoi: column(['preprint_doi']),
    codeDoi: column(['code_doi']),
    codeRepository: column(['git_repo_link']),
    dataDoi: column(['data_doi']),
  };
  const publications = [];
  const sourceRows = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const location = `Sheet row ${index + 1}`;
    if (!Array.isArray(row)) fail(location, 'expected a row of cells.');
    if (!flag(row[columns.visible], `${location} website`)) continue;
    const cell = (name) => columns[name] < 0 ? '' : scalar(row[columns[name]], `${location} ${name}`);
    const status = normalizePublicationStatus(cell('status'));
    // Preparation is intentionally hidden, even for explicitly selected tracker rows.
    if (status === 'in-preparation') continue;
    if (!PUBLIC_STATUSES.has(status)) fail(`${location} status`, 'use a supported publication or project status.');
    const ongoing = status === 'submitted' || status === 'under-review';
    const yearless = ongoing || status === 'accepted';
    const primaryDoi = ongoing ? '' : (cell('doi') || (status === 'preprint' ? cell('preprintDoi') : ''));
    const companionDoi = status === 'preprint' ? '' : cell('preprintDoi');
    const keywords = cell('keywords');
    const role = normalizePublicationStatus(cell('role'));
    const coFirstAuthor = columns.coFirst >= 0
      ? flag(row[columns.coFirst], `${location} co_first_author`)
      : CO_FIRST_ROLES.has(role);
    publications.push({
      id: cell('id') || null,
      title: cell('title'),
      authors: cell('authors'),
      coFirstAuthor,
      status,
      year: yearless ? null : (cell('year') || null),
      date: yearless ? null : (cell('date') || null),
      journal: ongoing ? null : (cell('journal') || null),
      doi: primaryDoi || null,
      pdf: ongoing ? null : (cell('pdf') || null),
      code: cell('codeDoi') || cell('codeRepository') || null,
      data: cell('dataDoi') || null,
      // Prefer semicolons when present so commas can remain inside a keyword phrase.
      keywords: keywords.split(keywords.includes(';') ? /[;\r\n]+/u : /[,\r\n]+/u).map(value => value.trim()).filter(Boolean),
      abstract: cell('abstract') || null,
      preprint: companionDoi && (!primaryDoi || doiKey(companionDoi) !== doiKey(primaryDoi))
        ? { doi: companionDoi } : null,
    });
    sourceRows.push(index + 1);
  }
  try {
    return validatePublicationData({ schemaVersion: 1, updatedAt, publications }).publications;
  } catch (error) {
    if (!(error instanceof PublicationDataError)) throw error;
    // Retain useful source row numbers without echoing private cell values.
    throw new PublicationDataError(error.message.replace(/Publication (\d+)/gu, (_, number) => `Sheet row ${sourceRows[Number(number) - 1]}`));
  }
}

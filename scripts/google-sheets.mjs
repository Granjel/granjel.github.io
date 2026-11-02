import { createSign } from 'node:crypto';
import { PUBLIC_SHEET_COLUMNS, BOOK_SHEET_COLUMNS, normalizeSheetHeader, hasPublicationHeaders, hasBookHeaders } from './sheet-publications.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets/';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const MAX_ROWS = 50000;

export class SheetSyncError extends Error {
  constructor(message) { super(message); this.name = 'SheetSyncError'; }
}

// All endpoints are fixed here. Never follow an endpoint supplied in a key file.
export function serviceAccountAssertion(credentialsJson, now = Date.now()) {
  let credentials;
  try { credentials = JSON.parse(credentialsJson); }
  catch { throw new SheetSyncError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
  if (credentials?.type !== 'service_account' || typeof credentials.client_email !== 'string'
    || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(credentials.client_email)
    || typeof credentials.private_key !== 'string'
    || (credentials.token_uri && credentials.token_uri !== TOKEN_URL)) {
    throw new SheetSyncError('The Google credential must be a service account key using the Google OAuth endpoint.');
  }
  const issuedAt = Math.floor(now / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
    iss: credentials.client_email, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600,
  });
  try {
    const signature = createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key, 'base64url');
    return `${unsigned}.${signature}`;
  } catch { throw new SheetSyncError('The Google service account private key could not be used.'); }
}

async function googleJson(url, options, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) });
  } catch { throw new SheetSyncError('The Google request failed or timed out. The saved website data was not changed.'); }
  if (!response.ok) {
    const hint = response.status === 403 ? ' Check that the Sheets API is enabled and the spreadsheet is shared with the service account as Viewer.' : '';
    throw new SheetSyncError(`Google request failed (HTTP ${response.status}).${hint}`);
  }
  let data;
  try {
    const body = await response.text();
    if (body.length > 8 * 1024 * 1024) throw new Error();
    data = JSON.parse(body);
  } catch { throw new SheetSyncError('Google returned an invalid or oversized response.'); }
  return data;
}

export async function sheetsAccessToken(credentialsJson, { fetchImpl = fetch } = {}) {
  const assertion = serviceAccountAssertion(credentialsJson);
  const data = await googleJson(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  }, fetchImpl);
  if (typeof data.access_token !== 'string' || !data.access_token) throw new SheetSyncError('Google did not return an access token.');
  return data.access_token;
}

export function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) { n--; name = String.fromCharCode(65 + n % 26) + name; n = Math.floor(n / 26); }
  return name;
}

async function fetchPublicationTabs({ spreadsheetId, credentialsJson, tab = '', fetchImpl = fetch }, includeBooks) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId || '')) throw new SheetSyncError('GOOGLE_SHEET_ID must contain the spreadsheet ID, not its URL.');
  const accessToken = await sheetsAccessToken(credentialsJson, { fetchImpl });
  const base = SHEETS_URL + encodeURIComponent(spreadsheetId);
  const headers = { Authorization: 'Bearer ' + accessToken };
  const metadataUrl = new URL(base);
  metadataUrl.searchParams.set('fields', 'sheets(properties(title,index,sheetType,gridProperties(rowCount,columnCount)))');
  const metadata = await googleJson(metadataUrl.href, { headers }, fetchImpl);
  if (!Array.isArray(metadata.sheets) || metadata.sheets.length > 100) throw new SheetSyncError('The spreadsheet metadata is invalid or has too many tabs.');
  let sheets = metadata.sheets.map(s => s.properties).filter(s => s?.sheetType === 'GRID' && typeof s.title === 'string').sort((a, b) => a.index - b.index);
  if (tab && !sheets.some(s => s.title === tab)) throw new SheetSyncError('The configured spreadsheet tab could not be found.');
  if (tab) sheets = sheets.filter(s => s.title === tab || (includeBooks && s.title === 'books-and-chapters'));
  if (!sheets.length) throw new SheetSyncError('The configured spreadsheet tab could not be found.');
  const quoted = title => "'" + title.replaceAll("'", "''") + "'";
  const batch = async ranges => {
    const url = new URL(base + '/values:batchGet');
    for (const range of ranges) url.searchParams.append('ranges', range);
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    url.searchParams.set('dateTimeRenderOption', 'FORMATTED_STRING');
    url.searchParams.set('fields', 'valueRanges(values)');
    const result = await googleJson(url.href, { headers }, fetchImpl);
    if (!Array.isArray(result.valueRanges) || result.valueRanges.length !== ranges.length) throw new SheetSyncError('Google returned an incomplete spreadsheet response.');
    return result.valueRanges.map(r => r.values || []);
  };
  if (sheets.some(s => !Number.isInteger(s.gridProperties?.columnCount) || s.gridProperties.columnCount < 1)) throw new SheetSyncError('The spreadsheet grid metadata is invalid.');
  const headerRanges = sheets.map(s => `${quoted(s.title)}!A1:${columnName(Math.min(s.gridProperties.columnCount, 702) - 1)}1`);
  const headerRows = await batch(headerRanges);
  const inspected = sheets.map((s, i) => ({ ...s, headerRange: headerRanges[i], headers: headerRows[i][0] || [] }));
  const candidates = inspected.filter(s => s.title !== 'books-and-chapters' && hasPublicationHeaders(s.headers));
  const namedJournal = inspected.find(s => s.title === 'journal-articles');
  if (namedJournal && !hasPublicationHeaders(namedJournal.headers)) throw new SheetSyncError('The journal-articles tab requires website, status, title and authors headers.');
  const journalCandidates = tab ? candidates.filter(s => s.title === tab) : (namedJournal ? [namedJournal] : candidates);
  if (journalCandidates.length !== 1) throw new SheetSyncError('Expected exactly one tab with website, status, title and authors headers. Set GOOGLE_SHEET_TAB if multiple tabs match.');
  const selected = [{ ...journalCandidates[0], kind: 'journal-articles', allowed: PUBLIC_SHEET_COLUMNS }];
  const books = includeBooks ? inspected.find(s => s.title === 'books-and-chapters') : null;
  if (books && books.headers.some(value => value != null && String(value).trim() !== '')) {
    if (!hasBookHeaders(books.headers)) throw new SheetSyncError('The books-and-chapters tab requires website, type, status, book_title, chapter_title and authors headers.');
    selected.push({ ...books, kind: 'books-and-chapters', allowed: BOOK_SHEET_COLUMNS });
  }
  const tabs = [];
  for (const source of selected) {
    const rowCount = source.gridProperties?.rowCount;
    if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_ROWS + 1) throw new SheetSyncError('The publication tab exceeds the 50000-row source limit or has invalid grid metadata.');
    const allowed = new Set(source.allowed);
    const columns = source.headers.map((header, index) => ({ header, index })).filter(c => allowed.has(normalizeSheetHeader(c.header)));
    // Read only the allowlisted columns for this tab, never notes/rejections/funding.
    const rows = [columns.map(c => c.header)];
    if (rowCount > 1) {
      const result = await batch([source.headerRange, ...columns.map(c => `${quoted(source.title)}!${columnName(c.index)}2:${columnName(c.index)}${rowCount}`)]);
      if (JSON.stringify(result[0][0] || []) !== JSON.stringify(source.headers)) throw new SheetSyncError('The Sheet columns changed during the read. Retry the update after editing the header row.');
      const values = result.slice(1);
      const length = Math.max(0, ...values.map(v => v.length));
      if (length > MAX_ROWS) throw new SheetSyncError('The publication tab exceeds the source row limit.');
      for (let r = 0; r < length; r++) rows.push(values.map(column => column[r]?.[0] ?? ''));
    }
    tabs.push({ kind: source.kind, rows });
  }
  return tabs;
}

// Backward-compatible single-tab reader for local integrations.
export async function fetchPublicSheetRows(options) {
  return (await fetchPublicationTabs(options, false))[0].rows;
}

// Journal discovery and optional named book tab share one readonly authentication.
export async function fetchPublicPublicationTabs(options) {
  return fetchPublicationTabs(options, true);
}

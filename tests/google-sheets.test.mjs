import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  serviceAccountAssertion, sheetsAccessToken, fetchPublicSheetRows, fetchPublicPublicationTabs, SHEETS_SCOPE, columnName,
} from '../scripts/google-sheets.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEET_ID = 'spreadsheet_example_12345';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
  type: 'service_account',
  client_email: 'sheet-reader@example-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }),
  token_uri: TOKEN_URL,
};
const credentialsJson = JSON.stringify(credentials);
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

const PRIMARY_HEADERS = ['id', 'website', 'status', 'authors', 'title', 'notes', 'abstract', 'prior_rejections_in_order', 'paper_doi'];
const PUBLIC_HEADERS = ['id', 'website', 'status', 'authors', 'title', 'abstract', 'paper_doi'];
const PRIMARY_RANGE = "'Paper''s list'!A1:I1";
const RAW_ROWS = [
  ['paper-one', 'yes', 'published', 'A. Researcher', 'A public paper', 'PRIVATE-NOTE-MARKER', 'An *italic* abstract.', 'PRIVATE-HISTORY-MARKER', '10.1234/example'],
  ['paper-two', 'no', 'writing', 'B. Researcher', 'Another record', 'PRIVATE-NOTE-MARKER', '', 'PRIVATE-HISTORY-MARKER', ''],
];

function sheetServer({ rowCount = 1001, ambiguous = false, mutateHeader = false } = {}) {
  const calls = [];
  let batches = 0;
  const internalColumns = ambiguous ? 9 : 5;
  const internalHeaders = ambiguous ? PRIMARY_HEADERS : ['Task', 'Budget', 'Owner', 'Salary', 'Notes'];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.href === TOKEN_URL) {
      assert.equal(options.method, 'POST');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const payload = JSON.parse(Buffer.from(body.get('assertion').split('.')[1], 'base64url').toString());
      assert.equal(payload.scope, SHEETS_SCOPE);
      assert.equal(Object.hasOwn(payload, 'sub'), false);
      return jsonResponse({ access_token: 'synthetic-test-access-token' });
    }
    assert.equal(url.origin, 'https://sheets.googleapis.com');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-access-token');
    assert.equal(url.searchParams.has('access_token'), false);
    if (url.pathname === `/v4/spreadsheets/${SHEET_ID}`) {
      assert.match(url.searchParams.get('fields'), /gridProperties/);
      return jsonResponse({ sheets: [
        { properties: { title: 'Internal', index: 1, sheetType: 'GRID', gridProperties: { rowCount: 100, columnCount: internalColumns } } },
        { properties: { title: "Paper's list", index: 0, sheetType: 'GRID', gridProperties: { rowCount, columnCount: 9 } } },
      ] });
    }
    assert.equal(url.pathname, `/v4/spreadsheets/${SHEET_ID}/values:batchGet`);
    assert.equal(url.searchParams.get('majorDimension'), 'ROWS');
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    const ranges = url.searchParams.getAll('ranges');
    batches++;
    if (batches === 1) {
      assert.ok(ranges.includes(PRIMARY_RANGE));
      return jsonResponse({ valueRanges: ranges.map(range => {
        if (range === PRIMARY_RANGE) return { values: [PRIMARY_HEADERS] };
        assert.equal(range, ambiguous ? "'Internal'!A1:I1" : "'Internal'!A1:E1");
        return { values: [internalHeaders] };
      }) });
    }
    assert.equal(batches, 2);
    // Re-read the header in the same batch to reject a concurrent column insertion.
    assert.equal(ranges[0], PRIMARY_RANGE);
    return jsonResponse({ valueRanges: ranges.map(range => {
      if (range === PRIMARY_RANGE) {
        const headers = [...PRIMARY_HEADERS];
        if (mutateHeader) headers[6] = 'private_salary';
        return { values: [headers] };
      }
      const match = /^'Paper''s list'!([A-I])2:([A-I])(\d+)$/u.exec(range);
      assert.ok(match, `Unexpected public-column range: ${range}`);
      assert.equal(match[1], match[2]);
      assert.equal(Number(match[3]), rowCount);
      assert.ok(!['F', 'H'].includes(match[1]), 'Private tracker columns must not be requested.');
      const index = match[1].charCodeAt(0) - 65;
      const values = RAW_ROWS.map(row => row[index] === '' ? [] : [row[index]]);
      while (values.length && values.at(-1).length === 0) values.pop();
      return { values };
    }) });
  };
  return { fetchImpl, calls };
}

test('service-account JWT is verifiably signed with the single readonly scope and no delegation', () => {
  const now = 1700000000000;
  const assertion = serviceAccountAssertion(credentialsJson, now);
  const [header, payload, signature] = assertion.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: TOKEN_URL,
    iat: 1700000000,
    exp: 1700003600,
  });
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
});

test('invalid keys and a non-Google credential endpoint fail without exposing their contents', () => {
  assert.throws(() => serviceAccountAssertion('PRIVATE-INVALID-JSON'), /not valid JSON/u);
  assert.throws(() => serviceAccountAssertion(JSON.stringify({ ...credentials, token_uri: 'https://example.invalid/token' })), /Google OAuth endpoint/u);
  assert.throws(() => serviceAccountAssertion(JSON.stringify({ ...credentials, private_key: 'PRIVATE-INVALID-KEY' })), error => {
    assert.match(error.message, /private key could not be used/u);
    assert.equal(error.message.includes('PRIVATE-INVALID-KEY'), false);
    return true;
  });
});

test('provider error bodies never enter the reported error', async () => {
  await assert.rejects(sheetsAccessToken(credentialsJson, {
    fetchImpl: async () => jsonResponse({ error: 'PRIVATE-GOOGLE-ERROR-BODY' }, 403),
  }), error => {
    assert.match(error.message, /HTTP 403/u);
    assert.equal(error.message.includes('PRIVATE-GOOGLE-ERROR-BODY'), false);
    return true;
  });
  await assert.rejects(sheetsAccessToken(credentialsJson, {
    fetchImpl: async () => { throw new Error('PRIVATE-NETWORK-ERROR'); },
  }), error => {
    assert.match(error.message, /failed or timed out/u);
    assert.equal(error.message.includes('PRIVATE-NETWORK-ERROR'), false);
    return true;
  });
});

test('fetch discovers one publication tab, escapes its name, and reads only allowed columns within its grid', async () => {
  const server = sheetServer();
  const rows = await fetchPublicSheetRows({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl });
  assert.equal(server.calls.length, 4);
  assert.equal(server.calls[0].url.href, TOKEN_URL);
  assert.equal(server.calls[1].url.pathname, `/v4/spreadsheets/${SHEET_ID}`);
  assert.deepEqual(server.calls[2].url.searchParams.getAll('ranges'), [PRIMARY_RANGE, "'Internal'!A1:E1"]);
  assert.deepEqual(rows, [PUBLIC_HEADERS,
    ['paper-one', 'yes', 'published', 'A. Researcher', 'A public paper', 'An *italic* abstract.', '10.1234/example'],
    ['paper-two', 'no', 'writing', 'B. Researcher', 'Another record', '', ''],
  ]);
  assert.equal(rows.flat().join('\n').includes('PRIVATE-'), false);
});

test('ambiguous publication tabs fail before requesting record values', async () => {
  const server = sheetServer({ ambiguous: true });
  await assert.rejects(fetchPublicSheetRows({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl }), /exactly one tab/u);
  assert.equal(server.calls.length, 3);
});

test('an explicitly configured tab resolves an otherwise ambiguous workbook', async () => {
  const server = sheetServer({ ambiguous: true });
  const rows = await fetchPublicSheetRows({ spreadsheetId: SHEET_ID, credentialsJson, tab: "Paper's list", fetchImpl: server.fetchImpl });
  assert.deepEqual(server.calls[2].url.searchParams.getAll('ranges'), [PRIMARY_RANGE]);
  assert.deepEqual(rows[0], PUBLIC_HEADERS);
});

test('a structural header change aborts rather than mislabelling private cells', async () => {
  const server = sheetServer({ mutateHeader: true });
  await assert.rejects(fetchPublicSheetRows({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl }), error => {
    assert.equal(error.name, 'SheetSyncError');
    assert.equal(error.message.includes('private_salary'), false);
    return true;
  });
  assert.equal(server.calls.length, 4);
});

test('a header-only grid does not request non-existent data rows', async () => {
  const server = sheetServer({ rowCount: 1 });
  const rows = await fetchPublicSheetRows({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl });
  assert.deepEqual(rows, [PUBLIC_HEADERS]);
  assert.equal(server.calls.length, 3);
});

test('a grid beyond the source cap is rejected before record values are requested', async () => {
  const server = sheetServer({ rowCount: 50002 });
  await assert.rejects(fetchPublicSheetRows({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl }), /source limit/u);
  assert.equal(server.calls.length, 3);
});

test('a spreadsheet URL is rejected before any authentication request', async () => {
  let requested = false;
  await assert.rejects(fetchPublicSheetRows({
    spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, credentialsJson,
    fetchImpl: async () => { requested = true; throw new Error(); },
  }), /spreadsheet ID, not its URL/u);
  assert.equal(requested, false);
});

test('column names cover the A1 boundary used to read wide header rows', () => {
  assert.deepEqual([0, 8, 25, 26, 36, 701].map(columnName), ['A', 'I', 'Z', 'AA', 'AK', 'ZZ']);
});

function bookSheetServer({ blankBooks = false, malformedBooks = false, headerOnlyBooks = false, mutateBookHeader = false, duplicateJournal = false } = {}) {
  const calls = [];
  const journalHeaders = ['id', 'website', 'status', 'title', 'authors', 'notes'];
  const bookHeaders = blankBooks ? [] : ['id', 'website', 'type', 'status', 'book_title', malformedBooks ? 'PRIVATE WRONG HEADER' : 'chapter_title', 'authors', 'notes', 'url', 'language'];
  const journalRow = ['journal-one', 'yes', 'published', 'A journal article', 'A. Author', 'PRIVATE JOURNAL NOTE'];
  const bookRow = ['chapter-one', 'yes', 'book chapter', 'published', 'A book', 'A chapter', 'B. Author', 'PRIVATE BOOK NOTE', 'https://example.org/chapter', 'es'];
  let batches = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input); calls.push({url, options});
    assert.equal(options.redirect, 'error');
    if (url.href === TOKEN_URL) return jsonResponse({ access_token: 'synthetic-test-access-token' });
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-access-token');
    if (url.pathname === `/v4/spreadsheets/${SHEET_ID}`) return jsonResponse({ sheets: [
      { properties: { title: 'journal-articles', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 10, columnCount: journalHeaders.length } } },
      { properties: { title: 'books-and-chapters', index: 1, sheetType: 'GRID', gridProperties: { rowCount: headerOnlyBooks ? 1 : 10, columnCount: 10 } } },
      ...(duplicateJournal ? [{ properties: { title: 'Archive', index: 2, sheetType: 'GRID', gridProperties: { rowCount: 10, columnCount: journalHeaders.length } } }] : []),
    ] });
    batches++;
    const ranges = url.searchParams.getAll('ranges');
    return jsonResponse({ valueRanges: ranges.map(range => {
      const match = /^'([^']+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/u.exec(range);
      assert.ok(match, 'Ranges must be narrow A1 column/header requests');
      const title = match[1];
      const isBook = title === 'books-and-chapters';
      const headers = isBook ? bookHeaders : journalHeaders;
      if (match[3] === '1') {
        const result = [...headers];
        if (isBook && mutateBookHeader && batches > 1) result[8] = 'PRIVATE CHANGED HEADER';
        return { values: result.length ? [result] : [] };
      }
      assert.notEqual(title, 'Archive', 'The named journal tab wins over other matching tabs');
      assert.equal(match[2], match[4]);
      const index = match[2].charCodeAt(0) - 65;
      assert.notEqual(index, isBook ? 7 : 5, 'Private tracker columns must not be requested');
      const value = (isBook ? bookRow : journalRow)[index];
      return { values: [[value]] };
    }) });
  };
  return { fetchImpl, calls };
}

test('two publication tabs share readonly authentication and use separate public field allowlists', async () => {
  const server = bookSheetServer({ duplicateJournal: true });
  const result = await fetchPublicPublicationTabs({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl });
  assert.deepEqual(result.map(source => source.kind), ['journal-articles', 'books-and-chapters']);
  assert.deepEqual(result[0].rows[0], ['id', 'website', 'status', 'title', 'authors']);
  assert.deepEqual(result[1].rows[0], ['id', 'website', 'type', 'status', 'book_title', 'chapter_title', 'authors', 'url', 'language']);
  assert.equal(result[1].rows[1][0], 'chapter-one');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(server.calls.filter(call => call.url.href === TOKEN_URL).length, 1);
});

test('configured journal selection still imports the named books-and-chapters tab', async () => {
  const server = bookSheetServer({ duplicateJournal: true });
  const result = await fetchPublicPublicationTabs({ spreadsheetId: SHEET_ID, credentialsJson, tab: 'journal-articles', fetchImpl: server.fetchImpl });
  assert.equal(result.length, 2);
  assert.deepEqual(server.calls[2].url.searchParams.getAll('ranges'), ["'journal-articles'!A1:F1", "'books-and-chapters'!A1:J1"]);
});

test('a stale explicitly configured journal tab fails before reading any cell values', async () => {
  const server = bookSheetServer();
  await assert.rejects(fetchPublicPublicationTabs({ spreadsheetId: SHEET_ID, credentialsJson, tab: 'Old tab name', fetchImpl: server.fetchImpl }), /configured spreadsheet tab could not be found/);
  assert.equal(server.calls.length, 2);
});

test('an empty books tab is harmless and a header-only books tab imports zero records', async () => {
  const blank = bookSheetServer({ blankBooks: true });
  const first = await fetchPublicPublicationTabs({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: blank.fetchImpl });
  assert.equal(first.length, 1);
  const headerOnly = bookSheetServer({ headerOnlyBooks: true });
  const second = await fetchPublicPublicationTabs({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: headerOnly.fetchImpl });
  assert.equal(second.length, 2);
  assert.equal(second[1].rows.length, 1);
  assert.equal(headerOnly.calls.length, 4);
});

test('malformed book headers and a header race abort without exposing private header text', async () => {
  for (const options of [{ malformedBooks: true }, { mutateBookHeader: true }]) {
    const server = bookSheetServer(options);
    await assert.rejects(fetchPublicPublicationTabs({ spreadsheetId: SHEET_ID, credentialsJson, fetchImpl: server.fetchImpl }), error => {
      assert.equal(error.name, 'SheetSyncError');
      assert.equal(error.message.includes('PRIVATE'), false);
      return true;
    });
  }
});

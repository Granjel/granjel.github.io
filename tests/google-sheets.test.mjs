import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  serviceAccountAssertion, sheetsAccessToken, fetchPublicSheetRows, SHEETS_SCOPE, columnName,
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

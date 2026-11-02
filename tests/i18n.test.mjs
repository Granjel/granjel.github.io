import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { rowsToPublications } from '../scripts/sheet-publications.mjs';
import { runInNewContext } from 'node:vm';
import { messages, supportedLanguages, languageInfo, normalizeLanguage, translate } from '../assets/i18n.js';

const languages = ['en', 'es', 'gl'];
const filename = (name, language) => name + (language === 'en' ? '' : '.' + language) + '.html';
const readOutput = name => readFile(new URL('../dist/' + name, import.meta.url), 'utf8');
const text = html => html.replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
const embedded = html => JSON.parse(html.match(/<script\b[^>]*id="publication-data"[^>]*>([\s\S]*?)<\/script>/u)[1]);
const cards = html => new Map([...html.matchAll(/<article\b[^>]*data-paper-id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/gu)].map(([, id, body]) => [id, body]));
const part = (html, expression) => html.match(expression)?.[1] || '';
const hrefs = html => [...html.matchAll(/\bhref="([^"]+)"/gu)].map(match => match[1]);
const attribute = (tag, name) => tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'u'))?.[1];
const initializer = html => html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];

function initialize(html, { savedLanguage, baseURI = 'https://example.test/research/publications.html', search = '?year=2026', hash = '#main', storageUnavailable = false } = {}) {
  const redirects = [];
  const writes = [];
  const dataset = {};
  const source = initializer(html);
  assert.ok(source, 'page has an appearance/language initializer');
  runInNewContext(source, {
    URL,
    document: { baseURI, documentElement: { dataset } },
    localStorage: {
      getItem: key => {
        if (storageUnavailable) throw new Error('Storage blocked');
        return key === 'field-notes-language' ? savedLanguage : key === 'field-notes-appearance' ? 'light' : null;
      },
      setItem: (key, value) => {
        if (storageUnavailable) throw new Error('Storage blocked');
        writes.push([key, value]);
      },
    },
    location: { href: new URL('missing/nested/path' + search + hash, baseURI).href, search, hash, replace: value => redirects.push(String(value)) },
  });
  return { redirects, writes, dataset };
}

test('English, Spanish and Galician cover the same messages and interpolation fields', () => {
  assert.deepEqual(supportedLanguages, languages);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
  for (const language of languages) {
    assert.deepEqual(Object.keys(messages[language]).sort(), Object.keys(messages.en).sort(), language);
    for (const key of Object.keys(messages.en)) {
      assert.equal(typeof messages[language][key], 'string', language + ': ' + key);
      assert.notEqual(messages[language][key].trim(), '', language + ': ' + key);
      assert.deepEqual(placeholders(messages[language][key]), placeholders(messages.en[key]), language + ': ' + key);
    }
  }
  assert.equal(translate('es', 'contact.email'), 'Correo electrónico');
  assert.equal(translate('gl', 'nav.about'), 'Sobre min');
  assert.equal(translate('gl', 'nav.publications'), 'Publicacións');
  assert.equal(translate('gl', 'resource.abstract'), 'Resumo');
  assert.equal(translate('gl', 'filter.year'), 'Ano');
  assert.equal(translate('gl', 'contact.address'), 'Enderezo');
  assert.equal(translate('gl', 'contact.profiles'), 'Perfís');
  for (const [language, expected] of [['en', 'Article'], ['es', 'Artículo'], ['gl', 'Artigo']]) {
    assert.equal(translate(language, 'type.journal-article'), expected);
  }
});

test('language normalization accepts Spanish and Galician regional tags without selecting unsupported languages', () => {
  for (const language of ['es', 'es-ES', 'ES-es', 'es_ES']) assert.equal(normalizeLanguage(language), 'es');
  for (const language of ['gl', 'gl-ES', 'GL-es', 'gl_ES']) assert.equal(normalizeLanguage(language), 'gl');
  for (const language of ['en', 'en-GB', 'fr', 'pt', 'glue', '', undefined, null, {}]) assert.equal(normalizeLanguage(language), 'en');
});

test('Preprint terminology stays unchanged in every language', () => {
  for (const language of languages) {
    assert.equal(translate(language, 'resource.preprint'), 'Preprint');
    assert.equal(translate(language, 'status.preprint'), 'Preprint');
    assert.equal(translate(language, 'section.preprints'), 'Preprints');
    assert.equal(translate(language, 'aria.preprint', { title: 'A study' }), 'Preprint: A study');
  }
});

test('translation resolves supplied values and reports missing keys or values', () => {
  const params = { count: 2, total: 10, name: 'A. Researcher', title: 'A study', editors: 'B. Editor', pages: '31–48' };
  for (const language of languages) {
    for (const key of Object.keys(messages[language])) {
      assert.doesNotMatch(translate(language, key, params), /\{(?:count|total|name|title|editors|pages)\}/u, key);
    }
    assert.throws(() => translate(language, 'unknown.message'), RangeError);
    assert.throws(() => translate(language, 'aria.copyDoi'), TypeError);
    assert.throws(() => translate(language, 'aria.copyIsbn'), TypeError);
  }
});

test('trilingual build translates the interface while preserving publication content and resources', async t => {
  const { buildSite } = await import('../scripts/build.mjs');
  await buildSite();
  const pageNames = ['index', 'about', 'publications', 'contact', '404'];
  const documents = new Map(await Promise.all(pageNames.flatMap(name => languages.map(async language => {
    const file = filename(name, language);
    return [file, await readOutput(file)];
  }))));
  assert.equal(documents.size, 15);

  await t.test('every page offers all three languages as ordinary links and identifies its document language', () => {
    for (const name of pageNames) {
      for (const language of languages) {
        const html = documents.get(filename(name, language));
        assert.equal(attribute(html.match(/<html\b[^>]*>/u)[0], 'lang'), languageInfo[language].tag, name);
        const picker = part(html, /<details\b(?=[^>]*\bdata-language-picker\b)[^>]*>([\s\S]*?)<\/details>/u);
        assert.ok(picker, name + ': native language picker works without JavaScript');
        const summary = picker.match(/<summary\b[^>]*>/u)?.[0];
        assert.ok(attribute(summary || '', 'aria-label'), name + ': labelled language picker');
        const choices = [...picker.matchAll(/<a\b(?=[^>]*\bdata-language-option\b)[^>]*>([\s\S]*?)<\/a>/gu)];
        assert.deepEqual(choices.map(choice => attribute(choice[0], 'data-target-language')), languages, name);
        for (let index = 0; index < languages.length; index += 1) {
          const target = languages[index];
          const choice = choices[index];
          assert.equal(attribute(choice[0], 'href'), filename(name, target), name + ': target page');
          assert.equal(attribute(choice[0], 'hreflang'), languageInfo[target].tag, name + ': link language');
          assert.equal(attribute(choice[0], 'lang'), languageInfo[target].tag, name + ': native language name pronunciation');
          assert.equal(text(choice[1]).trim(), languageInfo[target].label, name + ': native language name');
          assert.equal(attribute(choice[0], 'aria-current'), target === language ? 'true' : undefined, name + ': current selection');
        }
        assert.doesNotMatch(html, /\{(?:name|title|count|total)\}/u, name + ': no incomplete UI messages');
        const navigation = part(html, /<nav\b[^>]*>([\s\S]*?)<\/nav>/u);
        assert.deepEqual(hrefs(navigation), (name === 'index' ? ['about', 'publications', 'contact'] : ['index', 'about', 'publications', 'contact']).map(page => filename(page, language)));
      }
    }
  });

  await t.test('Spanish and Galician navigation, filters, biography, dates and Contact copy are translated', async () => {
    const original = JSON.parse(await readFile(new URL('../content/profile.json', import.meta.url), 'utf8'));
    for (const language of ['es', 'gl']) {
      const html = documents.get(filename('publications', language));
      for (const key of ['nav.publications', 'filter.filters', 'filter.searchPlaceholder', 'filter.year', 'filter.status', 'filter.journal', 'filter.keyword']) {
        assert.ok(text(html).includes(translate(language, key)) || html.includes(translate(language, key)), language + ': ' + key);
      }
      const profile = JSON.parse(await readFile(new URL('../content/profile.' + language + '.json', import.meta.url), 'utf8'));
      const about = text(documents.get(filename('about', language)));
      for (const paragraph of profile.biography) assert.ok(about.includes(paragraph), language + ': biography');
      assert.ok(text(documents.get(filename('index', language))).includes(profile.homepageRole), language + ': homepage role');
      for (const career of Object.values(profile.careerOverrides)) assert.ok(about.includes(career.dateLabel), language + ': career dates');
      for (const career of original.career) assert.ok(about.includes(career.institution), language + ': institution names remain unchanged');
      const contact = documents.get(filename('contact', language));
      for (const key of ['contact.email', 'contact.address', 'contact.profiles']) assert.ok(text(contact).includes(translate(language, key)), language + ': ' + key);
      assert.ok(contact.includes('mailto:rodrigo.granjel@bc3research.org'));
      assert.ok(text(contact).includes(profile.contact.addressLines.at(-1)), language + ': address');
      assert.ok(text(documents.get(filename('404', language))).includes(translate(language, 'notFound.title')));
    }
  });
  await t.test('About separates experience and education without losing career details', async () => {
    const original = JSON.parse(await readFile(new URL('../content/profile.json', import.meta.url), 'utf8'));
    const expected = new Map([
      ['bc3-postdoc', { category: 'experience', startDate: '2023-05-15', endDate: null }],
      ['ncsu-fulbright', { category: 'experience', startDate: '2022-06-19', endDate: '2023-03-15' }],
      ['sevilla-fpu', { category: 'experience', startDate: '2017-11', endDate: '2022-03' }],
      ['irnas-jae-intro', { category: 'experience', startDate: '2017-09', endDate: '2017-10' }],
      ['sevilla-phd', { category: 'education', startDate: '2017-11', endDate: '2023-04' }],
      ['uab-msc', { category: 'education', startDate: '2016-09-01', endDate: '2017-09-15' }],
      ['uvigo-bsc', { category: 'education', startDate: '2012-09-01', endDate: '2016-06-15' }],
    ]);
    assert.equal(original.career.length, expected.size, 'all seven career records remain present');
    assert.deepEqual(original.career.map(item => item.id).sort(), [...expected.keys()].sort(), 'career entries have stable distinct IDs even at the same institution');
    for (const item of original.career) {
      const reference = expected.get(item.id);
      assert.ok(reference, 'career entry has the expected stable identity');
      for (const field of ['category', 'startDate', 'endDate']) assert.equal(item[field], reference[field], item.institution + ': ' + field);
    }
    const byId = new Map(original.career.map(item => [item.id, item]));
    assert.equal(byId.get('sevilla-fpu').institutionUrl, byId.get('sevilla-phd').institutionUrl, 'FPU employment and the PhD correctly share an institution');
    assert.match(byId.get('sevilla-fpu').title, /FPU/u);
    assert.doesNotMatch(byId.get('sevilla-phd').title, /FPU/u, 'the degree title is independent of the funding contract');
    assert.match(byId.get('sevilla-phd').title, /Integrative Biology/u);
    assert.match(byId.get('irnas-jae-intro').title, /JAE-INTRO/u);
    for (const language of languages) {
      const html = documents.get(filename('about', language));
      const overrides = language === 'en' ? {} : JSON.parse(await readFile(new URL('../content/profile.' + language + '.json', import.meta.url), 'utf8')).careerOverrides;
      const allEntries = [];
      for (const category of ['experience', 'education']) {
        const sections = [...html.matchAll(new RegExp('<section\\b(?=[^>]*\\bid="' + category + '")[^>]*>([\\s\\S]*?)<\\/section>', 'gu'))];
        assert.equal(sections.length, 1, language + ': one independent ' + category + ' section');
        const section = sections[0][1];
        assert.equal(text(part(section, /<h2\b[^>]*>([\s\S]*?)<\/h2>/u)).trim(), translate(language, 'about.' + category), language + ': translated section heading');
        const entries = [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gu)].map(match => match[1]);
        const records = original.career.filter(item => expected.get(item.id).category === category).sort((a, b) => b.startDate.localeCompare(a.startDate));
        assert.equal(entries.length, records.length, language + ': expected ' + category + ' entry count');
        assert.deepEqual(hrefs(section), records.map(item => item.institutionUrl), language + ': institutions are in the correct section and date order');
        for (let index = 0; index < entries.length; index += 1) {
          const item = { ...records[index], ...(overrides[records[index].id] || overrides[records[index].institutionUrl] || {}) };
          const entry = entries[index];
          assert.ok(text(entry).includes(item.institution), language + ': institution name retained');
          assert.ok(text(entry).includes(item.dateLabel), language + ': career date label retained');
          assert.equal(text(part(entry, /<h3\b[^>]*>([\s\S]*?)<\/h3>/u)).trim(), item.title, language + ': localized career title retained');
          allEntries.push(text(entry));
        }
      }
      assert.equal(allEntries.length, expected.size, language + ': no career record was lost');
      assert.equal(new Set(allEntries).size, expected.size, language + ': no career record was duplicated');
      assert.ok(html.indexOf('id="experience"') < html.indexOf('id="education"'), language + ': experience comes before education');
    }
  });

  await t.test('publication metadata, order, abstracts, keywords and resource destinations remain identical', () => {
    const english = documents.get('publications.html');
    const enCards = cards(english);
    assert.ok(enCards.size > 0);
    const resourceLinks = body => hrefs(part(body, /<div\b[^>]*class="paper-links"[^>]*>([\s\S]*?)<\/div>/u));
    const copiedDois = body => [...body.matchAll(/data-copy-doi="([^"]+)"/gu)].map(match => match[1]);
    const copiedIsbns = body => [...body.matchAll(/data-copy-isbn="([^"]+)"/gu)].map(match => match[1]);
    for (const language of ['es', 'gl']) {
      const localized = documents.get(filename('publications', language));
      assert.deepEqual(embedded(localized), embedded(english), language + ': original publication records');
      const localizedCards = cards(localized);
      for (const record of embedded(localized).publications) {
        const body = localizedCards.get(record.id);
        const typeLabel = translate(language, 'type.' + (record.type || 'journal-article'));
        const statusLabel = translate(language, 'status.' + record.status);
        const expected = '<span class="contribution-label"><span class="contribution-type">' + typeLabel + '</span> <span class="status status-' + record.status + '">' + statusLabel + '</span></span>';
        assert.ok(body.includes(expected), language + ': ' + record.id + ': translated type precedes its status without losing its dot class');
      }
      assert.deepEqual([...localizedCards.keys()], [...enCards.keys()], language + ': paper order');
      for (const [id, en] of enCards) {
        const local = localizedCards.get(id);
        for (const expression of [
          /<h[34]\b[^>]*class="paper-title"[^>]*>([\s\S]*?)<\/h[34]>/u,
          /<p\b[^>]*class="paper-authors"[^>]*>([\s\S]*?)<\/p>/u,
          /<p\b[^>]*class="paper-journal"[^>]*>([\s\S]*?)<\/p>/u,
          /<div\b[^>]*class="paper-keywords"[^>]*>([\s\S]*?)<\/div>/u,
          /<div\b[^>]*class="abstract-content"[^>]*>([\s\S]*?)<\/div>/u,
        ]) assert.equal(text(part(local, expression)), text(part(en, expression)), language + ': ' + id + ': original research content');
        assert.deepEqual(resourceLinks(local), resourceLinks(en), language + ': ' + id + ': resource destinations');
        assert.deepEqual(copiedDois(local), copiedDois(en), language + ': ' + id + ': copied DOI');
        assert.deepEqual(copiedIsbns(local), copiedIsbns(en), language + ': ' + id + ': copied ISBN');
        for (const doi of copiedDois(local)) assert.match(doi, /^10\./u, 'copy controls retain bare DOIs');
      }
      assert.deepEqual([...localized.matchAll(/href="(assets\/papers\/[^"]+)"/gu)].map(match => match[1]), [...english.matchAll(/href="(assets\/papers\/[^"]+)"/gu)].map(match => match[1]), language + ': PDF paths');
    }
  });

  await t.test('publication filters retain their original machine values in every language', () => {
    const values = (html, id) => [...part(html, new RegExp('<select\\b[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)<\\/select>', 'u')).matchAll(/<option\b[^>]*value="([^"]+)"/gu)].map(match => match[1]).sort();
    const english = documents.get('publications.html');
    for (const id of ['paper-year', 'paper-status', 'paper-journal', 'paper-keyword']) {
      const expected = values(english, id);
      assert.ok(expected.includes('all'), id + ': unfiltered option remains addressable');
      for (const language of ['es', 'gl']) assert.deepEqual(values(documents.get(filename('publications', language)), id), expected, language + ': ' + id);
    }
  });

  await t.test('paper actions retain the requested order and shared Data/Code links stay combined', () => {
    const keys = ['resource.abstract', 'resource.pdf', 'resource.data', 'resource.combined', 'resource.code', 'resource.preprint'];
    for (const language of languages) {
      const html = documents.get(filename('publications', language));
      const labels = keys.map(key => translate(language, key));
      for (const [id, body] of cards(html)) {
        const actionBlock = part(body, /<div\b[^>]*class="paper-links"[^>]*>([\s\S]*?)<\/div>/u);
        const actions = [...actionBlock.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gu)]
          .map(match => text(match[1]).replace(/↗/gu, '').trim());
        const positions = actions.map(label => labels.indexOf(label));
        assert.ok(positions.every(index => index >= 0), language + ': ' + id + ': translated action labels');
        assert.deepEqual(positions, [...positions].sort((a, b) => a - b), language + ': ' + id + ': requested action order');
        if (actions.includes(translate(language, 'resource.combined'))) {
          assert.equal(actions.includes(translate(language, 'resource.data')), false, id + ': no duplicate Data button');
          assert.equal(actions.includes(translate(language, 'resource.code')), false, id + ': no duplicate Code button');
        }
      }
    }
  });

  await t.test('canonical alternates and sitemap expose the translated pages', async () => {
    for (const name of pageNames) {
      for (const language of languages) {
        const html = documents.get(filename(name, language));
        const canonical = html.match(/<link\b(?=[^>]*\brel="canonical")[^>]*>/u)?.[0];
        assert.ok(canonical, filename(name, language) + ': canonical URL');
        assert.ok(new URL(attribute(canonical, 'href')).pathname.endsWith('/' + filename(name, language)));
        const alternates = [...html.matchAll(/<link\b(?=[^>]*\brel="alternate")[^>]*>/gu)].map(match => match[0]);
        assert.deepEqual(alternates.map(link => attribute(link, 'hreflang')), languages.map(code => languageInfo[code].tag));
        for (let index = 0; index < languages.length; index += 1) {
          assert.ok(new URL(attribute(alternates[index], 'href')).pathname.endsWith('/' + filename(name, languages[index])));
        }
      }
    }
    const sitemap = await readOutput('sitemap.xml');
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => new URL(text(match[1])).pathname);
    assert.equal(locations.length, 12);
    for (const name of ['index', 'about', 'publications', 'contact']) {
      for (const language of languages) assert.ok(locations.some(path => path.endsWith('/' + filename(name, language))));
    }
    assert.equal(locations.some(path => path.includes('404')), false);
  });

  await t.test('saved Spanish and Galician preferences preserve the page, query and fragment', () => {
    for (const name of pageNames) {
      const html = documents.get(filename(name, 'en'));
      const base = name === '404' ? attribute(html.match(/<base\b[^>]*>/u)?.[0] || '', 'href') : '/research/' + filename(name, 'en');
      if (name === '404') assert.ok(base?.startsWith('/') && base.endsWith('/'), 'error-page links use the deployment root');
      const baseURI = new URL(base, 'https://example.test').href;
      for (const savedLanguage of ['es', 'gl']) {
        const result = initialize(html, { savedLanguage, baseURI });
        assert.deepEqual(result.redirects, [new URL(filename(name, savedLanguage) + '?year=2026#main', baseURI).href], name + ': ' + savedLanguage);
        assert.equal(result.dataset.theme, 'light', 'language preference preserves appearance');
      }
      for (const savedLanguage of [null, '', 'en', 'fr', '__proto__', 'constructor', '../../other', 'javascript:alert(1)']) {
        assert.deepEqual(initialize(html, { savedLanguage, baseURI }).redirects, [], name + ': unsupported stored values cannot redirect');
      }
    }
  });

  await t.test('explicit translated URLs win over saved preference and unavailable storage is harmless', () => {
    for (const name of pageNames) {
      for (const language of ['es', 'gl']) {
        const html = documents.get(filename(name, language));
        const result = initialize(html, { savedLanguage: language === 'es' ? 'gl' : 'es' });
        assert.deepEqual(result.redirects, [], name + ': explicit URL is retained');
        assert.ok(result.writes.some(([key, value]) => key === 'field-notes-language' && value === language), name + ': language choice persists');
      }
      for (const language of languages) {
        const result = initialize(documents.get(filename(name, language)), { savedLanguage: 'gl', storageUnavailable: true });
        assert.deepEqual(result.redirects, [], name + ': storage errors leave static navigation usable');
      }
    }
  });
});

test('selected middle-authored preparation projects render collapsed in all three languages', async () => {
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const temporaryParent = path.resolve(tmpdir());
  const fixtureRoot = await mkdtemp(path.join(temporaryParent, 'granjel-preparation-'));
  try {
    for (const directory of ['scripts', 'content', 'templates']) await mkdir(path.join(fixtureRoot, directory));
    await writeFile(path.join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const filename of ['build.mjs', 'publications.mjs']) await cp(path.join(sourceRoot, 'scripts', filename), path.join(fixtureRoot, 'scripts', filename));
    for (const filename of ['site.json', 'profile.json', 'profile.es.json', 'profile.gl.json', 'contact-icons.json']) await cp(path.join(sourceRoot, 'content', filename), path.join(fixtureRoot, 'content', filename));
    await cp(path.join(sourceRoot, 'templates', 'index-network.html'), path.join(fixtureRoot, 'templates', 'index-network.html'));
    const sourceAssets = path.join(sourceRoot, 'assets');
    await cp(sourceAssets, path.join(fixtureRoot, 'assets'), { recursive: true, filter: source => path.relative(sourceAssets, source).split(path.sep)[0] !== 'papers' });
    const columns = ['website', 'id', 'status', 'title', 'authors', 'journal', 'year', 'paper_doi', 'notes'];
    const middleAuthors = 'A. Author, Rodrigo R. Granjel, B. Author';
    const publications = rowsToPublications([
      columns,
      ['yes', 'prep-older', 'analysis', 'Alpha preparation project', middleAuthors, 'PRIVATE TARGET JOURNAL', 'PRIVATE YEAR', 'PRIVATE DOI', 'PRIVATE NOTES'],
      ['no', 'excluded-prep', 'writing', 'PRIVATE EXCLUDED PROJECT', middleAuthors, '', '', '', ''],
      ['', 'unset-prep', 'data ready', 'PRIVATE UNSET PROJECT', middleAuthors, '', '', '', ''],
      ['yes', 'prep-newer', 'writing', 'Zebra preparation project', middleAuthors, '', '', '', ''],
      ['yes', 'review-fixture', 'under review', 'Synthetic review paper', middleAuthors, 'PRIVATE REVIEW JOURNAL', '', '', ''],
      ['yes', 'published-fixture', 'published', 'Synthetic published paper', middleAuthors, 'Example Ecology', '2024', '10.1234/published.fixture', ''],
    ]);
    await writeFile(path.join(fixtureRoot, 'content', 'publications.json'), JSON.stringify({ schemaVersion: 1, updatedAt: '2026-11-01', publications }));
    execFileSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'build.mjs')], { cwd: fixtureRoot, windowsHide: true, stdio: 'pipe', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SITE_URL: 'https://example.test/research', SITE_ALLOW_INDEXING: 'false' } });
    for (const language of languages) {
      const html = await readFile(path.join(fixtureRoot, 'dist', filename('publications', language)), 'utf8');
      const section = html.match(/<details\b(?=[^>]*data-publication-section="preparation")[^>]*>([\s\S]*?)<\/details>/u);
      assert.ok(section, language + ': preparation section is present');
      const opening = section[0].slice(0, section[0].indexOf('>') + 1);
      assert.match(opening, /data-default-open="false"/u, language + ': preparation starts collapsed');
      assert.doesNotMatch(opening, /\s(?:open|hidden)(?:[\s=>])/u, language + ': section is available, without being expanded');
      assert.ok(text(section[1]).includes(translate(language, 'section.preparation')), language + ': localized section heading');
      const sectionCards = cards(section[1]);
      assert.deepEqual([...sectionCards.keys()], ['prep-newer', 'prep-older'], language + ': newest Sheet row first, without an alphabetical override');
      for (const body of sectionCards.values()) {
        assert.ok(text(body).includes(middleAuthors), language + ': selected middle authorship is included');
        assert.ok(text(body).includes(translate(language, 'status.in-preparation')), language + ': localized preparation status');
      }
      assert.deepEqual([...cards(html).keys()], ['prep-newer', 'prep-older', 'review-fixture', 'published-fixture'], language + ': preparation precedes review and published papers');
      const records = embedded(html).publications;
      assert.deepEqual(records.map(record => record.id), ['prep-older', 'prep-newer', 'review-fixture', 'published-fixture'], language + ': embedded records retain source order');
      assert.equal(records.filter(record => record.status === 'in-preparation').every(record => !record.coFirstAuthor), true, language + ': no co-first flag is required');
      assert.doesNotMatch(html, /PRIVATE/u, language + ': unchecked rows and private metadata stay out of the page');
      assert.doesNotMatch(section[1], /class="paper-year-group"/u, language + ': preparation is not assigned a publication-year group');
    }
  } finally {
    const resolved = path.resolve(fixtureRoot);
    assert.equal(path.dirname(resolved), temporaryParent, 'cleanup target stays within the temporary directory');
    assert.ok(path.basename(resolved).startsWith('granjel-preparation-'), 'cleanup target is the disposable fixture');
    await rm(resolved, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { messages, normalizeLanguage, translate } from '../assets/i18n.js';

const output = filename => new URL('../dist/' + filename, import.meta.url);
const readOutput = filename => readFile(output(filename), 'utf8');
const text = html => html.replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
const embedded = html => JSON.parse(html.match(/<script\b[^>]*id="publication-data"[^>]*>([\s\S]*?)<\/script>/u)[1]);
const cards = html => new Map([...html.matchAll(/<article\b[^>]*data-paper-id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/gu)].map(([, id, body]) => [id, body]));
const part = (html, expression) => html.match(expression)?.[1] || '';
const hrefs = html => [...html.matchAll(/\bhref="([^"]+)"/gu)].map(match => match[1]);

// These are shared product messages, not a second translated copy of the site.
test('English and Spain Spanish cover the same messages and interpolation fields', () => {
  assert.deepEqual(Object.keys(messages.es).sort(), Object.keys(messages.en).sort());
  for (const key of Object.keys(messages.en)) {
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
    for (const language of ['en', 'es']) {
      assert.equal(typeof messages[language][key], 'string', key);
      assert.notEqual(messages[language][key].trim(), '', key);
    }
    assert.deepEqual(placeholders(messages.es[key]), placeholders(messages.en[key]), key);
  }
  assert.equal(translate('es', 'nav.home'), 'Inicio');
  assert.equal(translate('es', 'resource.abstract'), 'Resumen');
  assert.equal(translate('es', 'filter.year'), 'Año');
  assert.equal(translate('es', 'contact.email'), 'Correo electrónico');
});

test('language normalization accepts Spain Spanish without selecting unsupported languages', () => {
  for (const language of ['es', 'es-ES', 'ES-es', 'es_ES']) assert.equal(normalizeLanguage(language), 'es');
  for (const language of ['en', 'en-GB', 'fr', '', undefined, null, {}]) assert.equal(normalizeLanguage(language), 'en');
});

test('translation resolves supplied values and reports missing keys or values', () => {
  const params = { count: 2, total: 10, name: 'A. Researcher', title: 'A study' };
  for (const language of ['en', 'es']) {
    for (const key of Object.keys(messages[language])) {
      assert.doesNotMatch(translate(language, key, params), /\{(?:count|total|name|title)\}/u, key);
    }
  }
  assert.throws(() => translate('es', 'unknown.message'), RangeError);
  assert.throws(() => translate('es', 'aria.copyDoi'), TypeError);
});

test('bilingual build translates the interface while preserving publication content and resources', async t => {
  const { buildSite } = await import('../scripts/build.mjs');
  await buildSite();
  const pageNames = ['index', 'about', 'publications', 'contact', '404'];
  const documents = new Map(await Promise.all(pageNames.flatMap(name => ['', '.es'].map(async suffix => {
    const filename = name + suffix + '.html';
    return [filename, await readOutput(filename)];
  }))));

  await t.test('every page has a usable counterpart link and the correct document language', () => {
    for (const name of pageNames) {
      for (const language of ['en', 'es']) {
        const suffix = language === 'es' ? '.es' : '';
        const other = language === 'es' ? 'en' : 'es';
        const html = documents.get(name + suffix + '.html');
        assert.match(html, new RegExp('<html\\b[^>]*lang="' + (language === 'es' ? 'es-ES' : 'en') + '"'), name);
        const switcher = html.match(/<a\b(?=[^>]*\bdata-language-toggle\b)[^>]*>/u)?.[0];
        assert.ok(switcher, name + ': language control works as an ordinary link');
        assert.match(switcher, new RegExp('href="' + name + (other === 'es' ? '\\.es' : '') + '\\.html"'), name);
        assert.match(switcher, new RegExp('data-target-language="' + other + '"'), name);
        assert.match(switcher, /aria-label="[^"]+"/u, name);
        assert.doesNotMatch(html, /\{(?:name|title|count|total)\}/u, name + ': no incomplete UI messages');
        if (name !== 'index') {
          const navigation = part(html, /<nav\b[^>]*>([\s\S]*?)<\/nav>/u);
          assert.deepEqual(hrefs(navigation), ['index', 'about', 'publications', 'contact'].map(page => page + suffix + '.html'));
        }
      }
    }
  });

  await t.test('Spanish navigation, filters, biography and contact copy are translated', async () => {
    const html = documents.get('publications.es.html');
    for (const key of ['nav.publications', 'filter.filters', 'filter.searchPlaceholder', 'filter.year', 'filter.status', 'filter.journal', 'filter.keyword']) {
      assert.ok(text(html).includes(translate('es', key)) || html.includes(translate('es', key)), key);
    }
    const profile = JSON.parse(await readFile(new URL('../content/profile.es.json', import.meta.url), 'utf8'));
    assert.ok(text(documents.get('about.es.html')).includes(profile.biography[0]));
    assert.ok(text(documents.get('index.es.html')).includes(profile.homepageRole));
    const contact = documents.get('contact.es.html');
    assert.ok(text(contact).includes(translate('es', 'contact.email')));
    assert.ok(text(contact).includes(translate('es', 'contact.address')));
    assert.ok(contact.includes('mailto:rodrigo.granjel@bc3research.org'));
    assert.ok(text(documents.get('404.es.html')).includes(translate('es', 'notFound.title')));
  });

  await t.test('paper metadata, order, abstracts, keywords and resource URLs remain unchanged', () => {
    const english = documents.get('publications.html');
    const spanish = documents.get('publications.es.html');
    assert.deepEqual(embedded(spanish), embedded(english));
    const enCards = cards(english);
    const esCards = cards(spanish);
    assert.ok(enCards.size > 0);
    assert.deepEqual([...esCards.keys()], [...enCards.keys()]);
    for (const [id, en] of enCards) {
      const es = esCards.get(id);
      for (const expression of [
        /<h[34]\b[^>]*class="paper-title"[^>]*>([\s\S]*?)<\/h[34]>/u,
        /<p\b[^>]*class="paper-authors"[^>]*>([\s\S]*?)<\/p>/u,
        /<p\b[^>]*class="paper-journal"[^>]*>([\s\S]*?)<\/p>/u,
        /<div\b[^>]*class="paper-keywords"[^>]*>([\s\S]*?)<\/div>/u,
        /<div\b[^>]*class="abstract-content"[^>]*>([\s\S]*?)<\/div>/u,
      ]) assert.equal(text(part(es, expression)), text(part(en, expression)), id + ': original research content');
      const resourceLinks = body => hrefs(part(body, /<div\b[^>]*class="paper-links"[^>]*>([\s\S]*?)<\/div>/u));
      assert.deepEqual(resourceLinks(es), resourceLinks(en), id + ': resource destinations');
      assert.deepEqual([...es.matchAll(/data-copy-doi="([^"]+)"/gu)].map(match => match[1]), [...en.matchAll(/data-copy-doi="([^"]+)"/gu)].map(match => match[1]), id + ': copied DOI');
    }
    assert.deepEqual([...spanish.matchAll(/href="(assets\/papers\/[^"]+)"/gu)].map(match => match[1]), [...english.matchAll(/href="(assets\/papers\/[^"]+)"/gu)].map(match => match[1]));
  });

  await t.test('paper action labels are translated and keep Abstract, PDF, Data, Code, Preprint order', () => {
    const keys = ['resource.abstract', 'resource.pdf', 'resource.data', 'resource.combined', 'resource.code', 'resource.preprint'];
    for (const language of ['en', 'es']) {
      const html = documents.get('publications' + (language === 'es' ? '.es' : '') + '.html');
      const labels = keys.map(key => translate(language, key));
      for (const [id, body] of cards(html)) {
        const actionBlock = part(body, /<div\b[^>]*class="paper-links"[^>]*>([\s\S]*?)<\/div>/u);
        const actions = [...actionBlock.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gu)]
          .map(match => text(match[1]).replace(/↗/gu, '').trim());
        const positions = actions.map(label => labels.indexOf(label));
        assert.ok(positions.every(index => index >= 0), id + ': all action labels use the selected language');
        assert.deepEqual(positions, [...positions].sort((a, b) => a - b), id + ': requested action order');
        if (actions.includes(translate(language, 'resource.combined'))) {
          assert.equal(actions.includes(translate(language, 'resource.data')), false, id + ': no duplicate Data button');
          assert.equal(actions.includes(translate(language, 'resource.code')), false, id + ': no duplicate Code button');
        }
      }
    }
  });

  await t.test('saved Spanish preference on a missing nested URL resolves to the real Spanish 404 page', () => {
    const html = documents.get('404.html');
    const base = html.match(/<base\b[^>]*href="([^"]+)"/u)?.[1];
    assert.ok(base?.startsWith('/') && base.endsWith('/'), '404 assets and navigation use the deployment root');
    const origin = 'https://example.test';
    const baseURI = new URL(base, origin).href;
    const redirects = [];
    const headInitializer = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
    assert.ok(headInitializer);
    runInNewContext(headInitializer, {
      URL,
      document: { baseURI, documentElement: { dataset: {} } },
      localStorage: { getItem: key => key === 'field-notes-language' ? 'es' : null },
      location: {
        href: origin + base + 'missing/nested/path?year=2026#main',
        search: '?year=2026', hash: '#main',
        replace: value => redirects.push(String(value)),
      },
    });
    assert.deepEqual(redirects, [new URL('404.es.html?year=2026#main', baseURI).href]);
  });

});

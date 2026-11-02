import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { translate } from '../assets/i18n.js';

const card = (html, id) => html.match(new RegExp('<article[^>]*data-paper-id="' + id + '"[^>]*>([\\s\\S]*?)<\\/article>', 'u'))?.[1];

test('books and chapters share Published year groups with journal papers and retain their own bibliographic details', async () => {
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const temporaryParent = path.resolve(tmpdir());
  const fixtureRoot = await mkdtemp(path.join(temporaryParent, 'granjel-books-'));
  try {
    for (const directory of ['scripts', 'content', 'templates']) await mkdir(path.join(fixtureRoot, directory));
    await writeFile(path.join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const filename of ['build.mjs', 'publications.mjs']) await cp(path.join(sourceRoot, 'scripts', filename), path.join(fixtureRoot, 'scripts', filename));
    for (const filename of ['site.json', 'profile.json', 'profile.es.json', 'profile.gl.json', 'contact-icons.json']) await cp(path.join(sourceRoot, 'content', filename), path.join(fixtureRoot, 'content', filename));
    await cp(path.join(sourceRoot, 'templates', 'index-network.html'), path.join(fixtureRoot, 'templates', 'index-network.html'));
    const sourceAssets = path.join(sourceRoot, 'assets');
    await cp(sourceAssets, path.join(fixtureRoot, 'assets'), { recursive: true, filter: source => path.relative(sourceAssets, source).split(path.sep)[0] !== 'papers' });
    await mkdir(path.join(fixtureRoot, 'assets', 'papers'));
    await writeFile(path.join(fixtureRoot, 'assets', 'papers', 'fixture-chapter.pdf'), '%PDF-1.4\n%%EOF');
    const common = { authors: 'Rodrigo R. Granjel, A. Author', status: 'published' };
    const chapter = { ...common, id: 'chapter', type: 'book-chapter', title: 'Diversidad edáfica', bookTitle: 'Conservación e xestión de humidais', year: 2017, language: 'es', editors: 'A. Editor & B. Editor', publisher: 'Horreum–IBADER', pages: '31–48', isbn: '978-84-939661-4-0', url: 'https://example.test/chapter', pdf: 'assets/papers/fixture-chapter.pdf', keywords: ['enchytraeids'], abstract: 'Habitats dominated by *Molinia* and *Sphagnum*.' };
    const book = { ...common, id: 'book', type: 'book', title: 'Ecology handbook', bookTitle: 'Ecology handbook', year: 2018, language: 'en', url: 'https://example.test/book', publisher: '<Example Press>' };
    const journal = { ...common, type: 'journal-article', id: 'journal', title: 'Journal research', journal: 'Example Ecology', year: 2024, doi: '10.1234/journal', url: 'https://example.test/unpreferred' };
    const defaultJournal = { ...journal, id: 'journal-default', type: undefined, title: 'Default-type journal research', year: 2025, doi: '10.1234/default' };
    const doiChapter = { ...chapter, id: 'chapter-with-doi', title: 'Chapter with a DOI and ISBN', year: 2019, doi: '10.1234/chapter', abstract: null, pdf: null };
    const doiOnlyChapter = { ...doiChapter, id: 'chapter-doi-only', title: 'Chapter with only a DOI', year: 2016, isbn: null, doi: '10.1234/chapter-only' };
    await writeFile(path.join(fixtureRoot, 'content', 'publications.json'), JSON.stringify({ schemaVersion: 1, updatedAt: '2026-11-02', publications: [chapter, book, journal, defaultJournal, doiChapter, doiOnlyChapter] }));
    execFileSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'build.mjs')], { cwd: fixtureRoot, windowsHide: true, stdio: 'pipe', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SITE_URL: 'https://example.test/research', SITE_ALLOW_INDEXING: 'false' } });
    for (const language of ['en', 'es', 'gl']) {
      const filename = 'publications' + (language === 'en' ? '' : '.' + language) + '.html';
      const html = await readFile(path.join(fixtureRoot, 'dist', filename), 'utf8');
      assert.deepEqual([...html.matchAll(/data-paper-id="([^"]+)"/gu)].map(match => match[1]), ['journal-default', 'journal', 'chapter-with-doi', 'book', 'chapter', 'chapter-doi-only']);
      assert.equal([...html.matchAll(/data-publication-section=/gu)].length, 1, 'one Published section');
      assert.match(html, /<h3 class="year-heading">2017<\/h3>/u);
      const chapterCard = card(html, 'chapter');
      assert.ok(chapterCard);
      assert.match(chapterCard, /class="paper-title" lang="es"><a href="https:\/\/example.test\/chapter"/u);
      assert.match(chapterCard, /class="paper-journal" lang="es">2017 · Conservación e xestión de humidais \(Horreum–IBADER\)<\/p>/u);
      assert.ok(chapterCard.includes(translate(language, 'type.book-chapter')));
      assert.ok(chapterCard.includes(translate(language, 'book.editors', { editors: 'A. Editor &amp; B. Editor' })));
      const chapterMeta = chapterCard.match(/<div class="paper-meta">([\s\S]*?)<\/div>/u)[1];
      assert.match(chapterMeta, /class="paper-doi paper-isbn"/u, 'ISBN shares the top-right identifier styling');
      assert.match(chapterMeta, /class="doi-value">ISBN 978-84-939661-4-0<\/span>/u);
      assert.match(chapterMeta, /data-copy-isbn="978-84-939661-4-0"/u, 'the clipboard copies the raw ISBN');
      assert.ok(chapterMeta.includes(translate(language, 'aria.copyIsbn', { title: chapter.title })));
      assert.doesNotMatch(chapterCard, /data-copy-doi/u, 'an ISBN does not create a fake DOI control');
      assert.doesNotMatch(chapterCard, /31–48/u, 'page ranges are not displayed on the card');
      const chapterDetails = chapterCard.match(/<p class="paper-book-details">([\s\S]*?)<\/p>/u)[1];
      assert.doesNotMatch(chapterDetails, /ISBN|978-84-939661-4-0|Horreum–IBADER/u, 'identifier and publisher are not duplicated below');
      assert.match(chapterCard, /class="abstract-content" lang="en"/u, 'the supplied English abstract is not relabelled as Spanish');
      assert.match(chapterCard, /<em>Molinia<\/em> and <em>Sphagnum<\/em>/u);
      assert.ok(chapterCard.indexOf('abstract-toggle') < chapterCard.indexOf('href="assets/papers/fixture-chapter.pdf"'));
      const bookCard = card(html, 'book');
      assert.ok(bookCard.includes(translate(language, 'type.book')));
      assert.ok(bookCard.includes('&lt;Example Press&gt;'));
      assert.equal((bookCard.match(/Ecology handbook/g) || []).length, 1, 'a whole book title is not repeated in its venue line');
      const journalCard = card(html, 'journal');
      assert.match(journalCard, /href="https:\/\/doi.org\/10.1234\/journal"/u, 'DOI remains the preferred title target');
      assert.doesNotMatch(journalCard, /paper-book-details|data-copy-isbn|ISBN/u, 'journal cards keep their existing DOI layout');
      const doiChapterCard = card(html, 'chapter-with-doi');
      assert.match(doiChapterCard, /href="https:\/\/doi.org\/10.1234\/chapter"/u, 'a chapter DOI remains the preferred title link');
      assert.match(doiChapterCard, /data-copy-isbn="978-84-939661-4-0"/u, 'ISBN is the visible identifier when a chapter has both identifiers');
      assert.doesNotMatch(doiChapterCard, /data-copy-doi/u, 'the chapter has only one top-right identifier control');
      const doiOnlyChapterCard = card(html, 'chapter-doi-only');
      assert.match(doiOnlyChapterCard, /data-copy-doi="10.1234\/chapter-only"/u, 'a book without an ISBN can still show its DOI');
      assert.doesNotMatch(doiOnlyChapterCard, /data-copy-isbn/u);
      const journalFilter = html.match(/<select id="paper-journal">([\s\S]*?)<\/select>/u)[1];
      assert.match(journalFilter, /Example Ecology/u);
      assert.doesNotMatch(journalFilter, /Conservación|Ecology handbook/u);
      const embedded = JSON.parse(html.match(/id="publication-data">([\s\S]*?)<\/script>/u)[1]);
      const savedChapter = embedded.publications.find(record => record.id === 'chapter');
      assert.equal(savedChapter.bookTitle, chapter.bookTitle);
      assert.equal(savedChapter.pages, chapter.pages, 'page data remains in the source record');
      assert.equal(savedChapter.isbn, chapter.isbn);
      assert.equal(savedChapter.publisher, chapter.publisher);
      for (const [id, type] of [['chapter', 'book-chapter'], ['book', 'book'], ['journal', 'journal-article'], ['journal-default', 'journal-article']]) {
        const body = card(html, id);
        const typeLabel = translate(language, 'type.' + type);
        const statusLabel = translate(language, 'status.published');
        const expected = '<div class="paper-meta"><span class="contribution-label"><span class="contribution-type">' + typeLabel + '</span> <span class="status status-published">' + statusLabel + '</span></span>';
        assert.ok(body.includes(expected), language + ': ' + id + ': type precedes the published label and its status-dot class');
        assert.equal((body.match(/class="contribution-type"/gu) || []).length, 1, language + ': one contribution label per card');
        const details = body.match(/<p class="paper-book-details">([\s\S]*?)<\/p>/u)?.[1] || '';
        assert.equal(details.includes(typeLabel), false, language + ': the contribution type is not repeated in book details');
      }
      assert.equal(embedded.publications.find(record => record.id === 'journal-default').type, 'journal-article', 'omitted type uses the journal article label');
    }
  } finally {
    const resolved = path.resolve(fixtureRoot);
    assert.equal(path.dirname(resolved), temporaryParent);
    assert.ok(path.basename(resolved).startsWith('granjel-books-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validatePublicationData } from './publications.mjs';
import { orderPublications, publicationGroup, normalizeKeywords, keywordKey } from '../assets/publication-utils.js';
import { formatInline, plainInline } from '../assets/inline-markdown.js';
import { supportedLanguages, languageInfo, translate } from '../assets/i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const contentHash = source => createHash('sha256').update(source).digest('hex').slice(0, 12);
const styleVersion = contentHash(await readFile(path.join(root, 'assets/site.css')));
const shareImage = 'assets/share-preview.png';
const shareImageVersion = contentHash(await readFile(path.join(root, shareImage)));
const inlineVersion = contentHash(await readFile(path.join(root, 'assets/inline-markdown.js')));
const i18nVersion = contentHash(await readFile(path.join(root, 'assets/i18n.js')));
const networkVersion = contentHash(await readFile(path.join(root, 'assets/network.js')));
const networkStyleVersion = contentHash(await readFile(path.join(root, 'assets/network.css')));
const clientUtilities = (await readFile(path.join(root, 'assets/publication-utils.js'), 'utf8'))
  .replace('./inline-markdown.js', './inline-markdown.js?v=' + inlineVersion);
const utilitiesVersion = contentHash(clientUtilities);
const clientScript = (await readFile(path.join(root, 'assets/site.js'), 'utf8'))
  .replace('./publication-utils.js', './publication-utils.js?v=' + utilitiesVersion)
  .replace('./inline-markdown.js', './inline-markdown.js?v=' + inlineVersion)
  .replace('./i18n.js', './i18n.js?v=' + i18nVersion);
const scriptVersion = contentHash(clientScript);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const readJSON = async filename => JSON.parse(await readFile(path.join(root, filename), 'utf8'));
const contactIcons = await readJSON('content/contact-icons.json');
const safeURL = value => { if (!value) return null; try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
const dateText = (value, language) => value ? new Intl.DateTimeFormat(languageInfo[language].tag, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : '';
const pageFile = (page, language = 'en') => (page === 'home' ? 'index' : page === 'not-found' ? '404' : page) + (language === 'en' ? '' : '.' + language) + '.html';
const t = (language, key, parameters) => escape(translate(language, key, parameters));

function authorText(authors) {
  return escape(authors).replace(/Rodrigo R\. Granjel/g, '<strong>Rodrigo R. Granjel</strong>');
}
function paperCard(paper, heading = 'h3', language = 'en') {
  const hasResources = publicationGroup(paper) === 'published' || paper.status === 'preprint';
  const bareDoi = paper.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') || '';
  const paperTitle = plainInline(paper.title);
  const doiHeader = hasResources && paper.doi ? '<div class="paper-doi"><span class="doi-value">' + escape(bareDoi) + '</span><button class="copy-doi js-only" type="button" data-copy-doi="' + escape(bareDoi) + '" aria-label="' + t(language, 'aria.copyDoi', { title: paperTitle }) + '"><svg class="clipboard-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><g class="clipboard-shape"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></g><path class="copy-check" d="m5 12 4 4L19 6"/></svg></button></div>' : '';
  const journalDetails = [(paper.status === 'published' || paper.status === 'preprint') ? paper.year : null, paper.journal].filter(Boolean).join(' · ');
  const tags = normalizeKeywords(paper.keywords || []).map(keyword => '<a class="keyword-tag" data-keyword="' + escape(keywordKey(keyword)) + '" href="' + pageFile('publications', language) + '?keyword=' + encodeURIComponent(keywordKey(keyword)) + '">' + formatInline(keyword) + '</a>').join('');
  const title = hasResources && paper.doi ? '<a href="' + escape(paper.doi) + '" target="_blank" rel="noopener noreferrer">' + formatInline(paper.title) + '</a>' : formatInline(paper.title);
  const abstractButton = paper.abstract ? '<button class="abstract-toggle js-only" type="button" aria-expanded="false" aria-controls="abstract-' + escape(paper.id) + '">' + t(language, 'resource.abstract') + ' <svg class="abstract-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6L8 10L12 6"/></svg></button>' : '';
  const preprintLink = paper.preprint ? '<a href="' + escape(paper.preprint.doi) + '" target="_blank" rel="noopener noreferrer" aria-label="' + t(language, 'aria.preprint', { title: plainInline(paper.preprint.title || paper.title) }) + '">' + t(language, 'resource.preprint') + ' <svg class="resource-icon preprint-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h3M14 2l6 6v2M14 2v6h6M8 12h4M8 16h1"/><path d="m18 12 4 4-7 7h-4v-4Zm-1 1 4 4"/></svg></a>' : '';
  const versionNote = paper.preprint?.note ? '<p class="preprint-version-note" lang="en">' + formatInline(paper.preprint.note) + '</p>' : '';
  const resources = hasResources ? [
    paper.pdf ? '<a href="' + escape(paper.pdf) + '" target="_blank" rel="noopener noreferrer" aria-label="' + t(language, 'aria.pdf', { title: paperTitle }) + '">' + t(language, 'resource.pdf') + ' <svg class="document-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg></a>' : ''
  ].join('') : '';
  const combinedDataAndCode = Boolean(paper.data && paper.data === paper.code);
  const dataLabel = t(language, combinedDataAndCode ? 'resource.combined' : 'resource.data');
  const dataIconPaths = combinedDataAndCode
    ? '<ellipse cx="9" cy="5" rx="6" ry="3"/><path d="M3 5v12c0 1.7 2.7 3 6 3M15 5v5M3 11c0 1.7 2.7 3 6 3"/><path d="m14 14-3 3 3 3m6-6 3 3-3 3"/>'
    : '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>';
  const artifactLinks = [
    paper.data ? '<a href="' + escape(paper.data) + '" target="_blank" rel="noopener noreferrer" aria-label="' + t(language, combinedDataAndCode ? 'aria.combined' : 'aria.data', { title: paperTitle }) + '">' + dataLabel + ' <svg class="resource-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + dataIconPaths + '</svg></a>' : '',
    paper.code && !combinedDataAndCode ? '<a href="' + escape(paper.code) + '" target="_blank" rel="noopener noreferrer" aria-label="' + t(language, 'aria.code', { title: paperTitle }) + '">' + t(language, 'resource.code') + ' <svg class="resource-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6m6-14-4 16"/></svg></a>' : ''
  ].join('');
  return '<article class="paper-card" data-paper-id="' + escape(paper.id) + '"><div class="paper-body">' +
    '<div class="paper-meta"><span class="status status-' + escape(paper.status) + '">' + t(language, 'status.' + paper.status) + '</span>' + doiHeader + '</div>' +
    '<' + heading + ' class="paper-title" lang="en">' + title + '</' + heading + '><p class="paper-authors">' + authorText(paper.authors) + '</p>' +
    (journalDetails ? '<p class="paper-journal" lang="en">' + escape(journalDetails) + '</p>' : '') +
    (tags ? '<div class="paper-keywords" lang="en" aria-label="' + t(language, 'aria.keywords') + '">' + tags + '</div>' : '') +
    (abstractButton || resources || artifactLinks || preprintLink ? '<div class="paper-links">' + abstractButton + resources + artifactLinks + preprintLink + '</div>' : '') +
    versionNote +
    (paper.abstract ? '<div class="abstract-content" lang="en" id="abstract-' + escape(paper.id) + '"><p>' + formatInline(paper.abstract) + '</p></div>' : '') +
    (hasResources && paper.doi ? '<span class="copy-status sr-only" role="status" aria-atomic="true"></span><div class="doi-manual" hidden><p>' + t(language, 'copy.prompt') + '</p><input type="text" readonly value="' + escape(bareDoi) + '" aria-label="' + t(language, 'aria.doi', { title: paperTitle }) + '"></div>' : '') + '</div></article>';
}

function publicationSection(key, papers, open, language) {
  if (!papers.length) return '';
  let content;
  if (key === 'published') {
    const publishedPapers = papers.filter(paper => paper.status === 'published');
    const accepted = papers.filter(paper => paper.status === 'accepted');
    const years = [...new Set(publishedPapers.map(paper => paper.year))].sort((a, b) => (b || 0) - (a || 0));
    content = (accepted.length ? '<div class="paper-grid accepted-papers">' + accepted.map(paper => paperCard(paper, 'h3', language)).join('') + '</div>' : '') + years.map(year => '<section class="paper-year-group" data-year-group>' +
      (year ? '<h3 class="year-heading">' + escape(year) + '</h3>' : '') +
      '<div class="paper-grid">' + publishedPapers.filter(paper => paper.year === year).map(paper => paperCard(paper, year ? 'h4' : 'h3', language)).join('') + '</div></section>').join('');
  } else {
    content = '<div class="paper-grid">' + papers.map(paper => paperCard(paper, 'h3', language)).join('') + '</div>';
  }
  return '<details class="publication-section" data-publication-section="' + key + '" data-default-open="' + open + '"' + (open ? ' open' : '') + '>' +
    '<summary class="publication-section-heading"><h2>' + t(language, 'section.' + key) + '</h2><span class="section-count" data-section-count>' + papers.length + '</span><svg class="section-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6L8 10L12 6"/></svg></summary>' +
    '<div class="publication-section-body">' + content + '</div></details>';
}

function profileLinks(profile) {
  const links = [];
  for (const [key, label] of [['orcid', 'ORCID'], ['scholar', 'Google Scholar'], ['github', 'GitHub'], ['bluesky', 'Bluesky'], ['linkedin', 'LinkedIn']]) {
    const url = safeURL(profile.links?.[key]);
    if (!url) continue;
    const icon = contactIcons[key];
    const logo = icon ? '<svg class="platform-icon" viewBox="' + escape(icon.viewBox) + '" fill="currentColor" aria-hidden="true" focusable="false">' + icon.paths.map(d => '<path d="' + escape(d) + '"/>').join('') + '</svg>' : '';
    links.push('<a data-platform="' + escape(key) + '" href="' + escape(url) + '" target="_blank" rel="noopener noreferrer"><span class="profile-link-label">' + logo + '<span>' + label + '</span></span><span class="profile-link-arrow" aria-hidden="true">↗</span></a>');
  }
  return links.join('');
}

function layout({ profile, page, title, description, content, data, siteURL, indexable, language }) {
  const file = pageFile(page, language);
  const languageName = languageInfo[language].label;
  const canonical = siteURL ? new URL(file, siteURL + '/').href : null;
  const errorBase = page === 'not-found' ? '<base href="' + escape(siteURL ? new URL(siteURL + '/').pathname : '/') + '">' : '';
  const fragmentPage = page === 'not-found' ? file : '';
  const nav = ['home', 'about', 'publications', 'contact']
    .map(key => '<a href="' + pageFile(key, language) + '"' + (page === key ? ' aria-current="page"' : '') + '>' + t(language, 'nav.' + key) + '</a>').join('');
  const themeButton = '<button class="theme-toggle js-only" type="button" aria-label="' + t(language, 'theme.toLight') + '"><span data-theme-label>' + t(language, 'theme.light') + '</span><span class="theme-dot" aria-hidden="true"></span></button>';
  const languageButton = '<details class="language-picker" data-language-picker><summary class="language-summary" aria-label="' + t(language, 'language.choose') + ' (' + escape(languageName) + ')"><span>' + escape(languageInfo[language].abbreviation) + '</span><svg class="language-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4.5L6 7.5L9 4.5"/></svg></summary><div class="language-options">' + supportedLanguages.map(code => '<a class="language-option" data-language-option data-target-language="' + code + '" href="' + pageFile(page, code) + '" hreflang="' + languageInfo[code].tag + '" lang="' + languageInfo[code].tag + '"' + (code === language ? ' aria-current="true"' : '') + '>' + escape(languageInfo[code].label) + '</a>').join('') + '</div></details>';
  const controls = '<div class="header-controls">' + themeButton + languageButton + '</div>';
  const header = page === 'home' ?
    '<header class="site-header index-header">' + controls + '</header>' :
    '<header class="site-header"><a class="wordmark" href="' + pageFile('home', language) + '" aria-label="' + t(language, 'aria.index', { name: profile.name }) + '">' + escape(profile.name) + '</a><button class="menu-toggle js-only" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="' + t(language, 'common.menu') + '"><span aria-hidden="true">☰</span></button><nav id="site-nav" class="site-nav" aria-label="' + t(language, 'nav.main') + '">' + nav + '</nav>' + controls + '</header>';
  const rememberedPages = Object.fromEntries(supportedLanguages.filter(code => code !== 'en').map(code => [code, pageFile(page, code)]));
  const languageInit = language !== 'en'
    ? 'localStorage.setItem("field-notes-language",' + JSON.stringify(language) + ');'
    : 'var savedLanguage=localStorage.getItem("field-notes-language");var languagePages=' + JSON.stringify(rememberedPages) + ';if(Object.prototype.hasOwnProperty.call(languagePages,savedLanguage))location.replace(new URL(languagePages[savedLanguage],document.baseURI).href+location.search+location.hash);';
  return '<!doctype html>\n<html lang="' + languageInfo[language].tag + '" data-language="' + language + '" data-theme="dark"><head><meta charset="utf-8">' + errorBase + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) +
    '</title><meta name="description" content="' + escape(description) + '"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="#101613"><meta name="robots" content="' +
    (indexable ? 'index,follow' : 'noindex,nofollow') + '">' +
    (canonical ? '<link rel="canonical" href="' + escape(canonical) + '">' + supportedLanguages.map(alternate => '<link rel="alternate" hreflang="' + languageInfo[alternate].tag + '" href="' + escape(new URL(pageFile(page, alternate), siteURL + '/').href) + '">').join('') : '') +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + escape(title) + '"><meta property="og:description" content="' + escape(description) + '">' +
    (canonical ? '<meta property="og:url" content="' + escape(canonical) + '"><meta property="og:image" content="' + escape(new URL(shareImage + '?v=' + shareImageVersion, siteURL + '/').href) + '"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="' + escape(profile.name) + '"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' + escape(new URL(shareImage + '?v=' + shareImageVersion, siteURL + '/').href) + '"><meta name="twitter:image:alt" content="' + escape(profile.name) + '">' : '') +
    '<script>try{var t=localStorage.getItem("field-notes-appearance");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}try{' + languageInit + '}catch(e){}</script>' +
    '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/site.css?v=' + styleVersion + '">' +
    (page === 'home' ? '<link rel="stylesheet" href="assets/network.css?v=' + networkStyleVersion + '"><script type="module" src="assets/network.js?v=' + networkVersion + '"></script>' : '') +
    '<script type="module" src="assets/site.js?v=' + scriptVersion + '"></script></head>' +
    '<body id="top" tabindex="-1" data-page="' + page + '"><a class="skip-link" href="' + fragmentPage + '#main">' + t(language, 'common.skip') + '</a><div class="page-shell">' + header + '<main id="main">' + content + '</main><footer class="site-footer"><span>© ' + new Date().getUTCFullYear() + ' ' + escape(profile.name) + '</span>' + '<a class="back-to-top" href="' + fragmentPage + '#top">' + t(language, 'common.backToTop') + ' ↑</a>' + '</footer></div>' +
    (data ? '<script type="application/json" id="publication-data">' + safeJSON(data) + '</script>' : '') + '</body></html>';
}

function home(profile, network, language) {
  const currentPosition = profile.career.find(item => !item.endDate);
  const role = profile.homepageRole || currentPosition?.title;
  const rolePhrase = escape(translate(language, 'home.highlight'));
  const roleHTML = escape(role || '').replace(rolePhrase, phrase => '<mark class="role-highlight">' + phrase + '</mark>');
  const institutionURL = safeURL(currentPosition?.institutionUrl);
  const institutionLabel = escape(currentPosition?.institutionShortName || currentPosition?.institution);
  const institution = institutionURL ? '<a href="' + escape(institutionURL) + '" target="_blank" rel="noopener noreferrer">' + institutionLabel + '</a>' : institutionLabel;
  const localizedNetwork = network.replace(/\{\{([\w.]+)\}\}/g, (_, key) => key.startsWith('href.') ? pageFile(key.slice(5), language) : t(language, key));
  return '<section class="index-intro"><h1>' + escape(profile.name) + '</h1>' +
    (currentPosition?.institution ? '<p class="index-description index-affiliation">' + roleHTML + (role ? ' ' + t(language, 'common.at') + '&nbsp;' : '') + institution + '</p>' : '') + '</section>' + localizedNetwork;
}

function publications(data, language) {
  const papers = orderPublications(data.publications);
  const years = [...new Set(papers.filter(paper => paper.status === 'published' || paper.status === 'preprint').map(paper => paper.year).filter(Boolean))].sort((a, b) => b - a);
  const journals = [...new Set(papers.map(paper => paper.journal).filter(Boolean))].sort((a, b) => a.localeCompare(b, language));
  const keywordMap = new Map();
  for (const paper of papers) for (const keyword of normalizeKeywords(paper.keywords || [])) keywordMap.set(keywordKey(keyword), keyword);
  const keywords = [...keywordMap.entries()].map(([key, label]) => [key, plainInline(label)]).sort((a, b) => a[1].localeCompare(b[1], language));
  const select = (id, labelKey, options, feminine = false) => '<div class="filter-field"><label for="' + id + '">' + t(language, labelKey) + '</label><select id="' + id + '"><option value="all">' + t(language, feminine ? 'common.allFeminine' : 'common.all') + '</option>' + options.map(([value, text]) => '<option value="' + escape(value) + '">' + escape(text) + '</option>').join('') + '</select></div>';
  return '<section class="page-title publications-title"><h1>' + t(language, 'nav.publications') + '</h1></section><section class="publication-library" aria-label="' + t(language, 'aria.publicationExplorer') + '">' +
    '<div class="results-heading"><button type="button" class="filters-toggle js-only" id="toggle-filters" aria-expanded="false" aria-controls="publication-filters"><span>' + t(language, 'filter.filters') + '</span><span id="active-filter-count" class="filter-count" hidden></span><svg class="filters-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4.5L6 7.5L9 4.5"/></svg></button><p id="results-count" role="status" aria-live="polite">' + t(language, papers.length === 1 ? 'results.one' : 'results.many', { count: papers.length }) + '</p></div><form class="publication-controls js-only" role="search" id="publication-filters" hidden><div class="search-field"><label for="paper-search" class="sr-only">' + t(language, 'filter.search') + '</label><input id="paper-search" name="q" type="search" maxlength="200" placeholder="' + t(language, 'filter.searchPlaceholder') + '" autocomplete="off"></div><div class="select-fields">' +
    select('paper-year', 'filter.year', years.map(year => [year, year])) +
    select('paper-status', 'filter.status', ['in-preparation', 'submitted', 'under-review', 'accepted', 'published', 'preprint'].filter(status => papers.some(paper => paper.status === status)).map(status => [status, translate(language, 'status.' + status)])) +
    select('paper-journal', 'filter.journal', journals.map(journal => [journal, journal]), true) +
    select('paper-keyword', 'filter.keyword', keywords, true) +
    '</div><button type="button" class="reset-filters" id="reset-filters">' + t(language, 'filter.clear') + '</button></form>' +
    '<div id="paper-list">' + ['preparation', 'submitted', 'preprints', 'published'].map(group => publicationSection(group, papers.filter(paper => publicationGroup(paper) === group), group !== 'preparation', language)).join('') + '</div>' +
    '<div id="empty-results" class="empty-results"' + (papers.length ? ' hidden' : '') + '><h2>' + t(language, 'results.none') + '</h2><p>' + t(language, 'results.tryAgain') + '</p><button type="button" class="button" id="reset-empty">' + t(language, 'filter.clear') + '</button></div>' +
    '<noscript><p class="snapshot-note">' + t(language, 'results.noScript') + '</p></noscript></section>';
}

function careerSection(profile, category, language) {
  const entries = profile.career.filter(item => item.category === category).sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (!entries.length) return '';
  return '<section class="career-section" id="' + category + '" aria-labelledby="' + category + '-heading"><h2 id="' + category + '-heading">' + t(language, 'about.' + category) + '</h2><ol class="career-list">' + entries.map(item => {
    const institutionURL = safeURL(item.institutionUrl);
    return '<li><div class="career-date">' + escape(item.dateLabel || (dateText(item.startDate, language) + ' — ' + (item.endDate ? dateText(item.endDate, language) : translate(language, 'common.present')))) +
      '</div><div><h3>' + escape(item.title) + '</h3><p class="career-institution">' + (institutionURL ? '<a href="' + escape(institutionURL) + '" target="_blank" rel="noopener noreferrer">' + escape(item.institution) + '</a>' : escape(item.institution)) +
      '</p>' + (item.location ? '<p class="career-place">' + escape(item.location) + '</p>' : '') + '</div></li>';
  }).join('') + '</ol></section>';
}

function about(profile, language) {
  return '<section class="page-title"><h1>' + t(language, 'nav.about') + '</h1></section><section class="biography"><figure class="portrait-figure"><img src="' + escape(profile.portrait) + '" alt="' + t(language, 'aria.portrait', { name: profile.name }) +
    '" width="753" height="851"></figure><div class="biography-copy">' + (profile.biography || [profile.shortBio]).map(paragraph => '<p>' + escape(paragraph) + '</p>').join('') +
    '</div></section>' + careerSection(profile, 'experience', language) + careerSection(profile, 'education', language);
}

function contact(profile, language) {
  const emailValue = profile.links?.email;
  const email = emailValue && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailValue)
    ? '<section class="contact-email" aria-labelledby="contact-email-label"><h2 class="contact-label" id="contact-email-label">' + t(language, 'contact.email') + '</h2><a class="contact-email-link" href="mailto:' + escape(emailValue) + '"><span>' + escape(emailValue).replace('@', '<wbr>@') + '</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 17 17 7M7 7h10v10"/></svg></a></section>' : '';
  const addressLines = profile.contact?.addressLines || [];
  const address = addressLines.length
    ? '<section class="contact-address" aria-labelledby="contact-address-label"><h2 class="contact-label" id="contact-address-label">' + t(language, 'contact.address') + '</h2><address><span class="contact-institution">' + escape(addressLines[0]) + '</span>' + addressLines.slice(1).map(escape).join('<br>') + '</address></section>' : '';
  const profiles = profileLinks(profile);
  return '<section class="page-title"><h1>' + t(language, 'nav.contact') + '</h1></section><section class="contact-page">' +
    (email || address ? '<div class="contact-details' + (!email || !address ? ' is-single' : '') + '">' + email + address + '</div>' : '') +
    (profiles ? '<section class="contact-profiles" aria-labelledby="contact-profiles-label"><h2 class="contact-label" id="contact-profiles-label">' + t(language, 'contact.profiles') + '</h2><div class="profile-links">' + profiles + '</div></section>' : '') + '</section>';
}

function localizeProfile(profile, copy, language) {
  if (language === 'en') return profile;
  const { careerOverrides = {}, contact: translatedContact, ...translated } = copy;
  return {
    ...profile,
    ...translated,
    career: profile.career.map(item => {
      const override = careerOverrides[item.institutionUrl] || {};
      return { ...item, dateLabel: null, ...override };
    }),
    contact: { ...profile.contact, ...translatedContact },
  };
}

export async function buildSite() {
  const siteConfig = await readJSON('content/site.json');
  const profile = await readJSON('content/profile.json');
  const translatedProfiles = Object.fromEntries(await Promise.all(supportedLanguages.filter(language => language !== 'en').map(async language => [language, await readJSON('content/profile.' + language + '.json')])));
  const raw = await readJSON('content/publications.json');
  const validated = validatePublicationData(raw);
  // The Sheet's website flag controls inclusion, including preparation projects.
  // Target journals are private: omit them from both rendered cards and browser data.
  const data = { ...validated, publications: validated.publications
    .map(paper => ['preparation', 'submitted'].includes(publicationGroup(paper)) ? { ...paper, journal: null } : paper) };
  const network = await readFile(path.join(root, 'templates/index-network.html'), 'utf8');
  for (const required of ['name', 'shortBio', 'portrait', 'career']) if (!profile[required]) throw new Error('Missing profile field: ' + required);
  for (const item of profile.career) if (!['experience', 'education'].includes(item.category)) throw new Error('Career entries must set category to experience or education.');
  // A new portrait gets a new URL even when its filename stays the same.
  const portraitVersion = contentHash(await readFile(path.join(root, profile.portrait)));
  profile.portrait += '?v=' + portraitVersion;
  const configuredURL = safeURL(process.env.SITE_URL || siteConfig.url);
  const siteURL = configuredURL ? configuredURL.replace(/\/$/, '') : null;
  const indexable = process.env.SITE_ALLOW_INDEXING === 'true';
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(output)) await rm(path.join(output, entry), { recursive: true, force: true });
  await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
  await writeFile(path.join(output, 'assets/publication-utils.js'), clientUtilities);
  await writeFile(path.join(output, 'assets/site.js'), clientScript);
  const pages = [];
  for (const language of supportedLanguages) {
    const localProfile = localizeProfile(profile, translatedProfiles[language], language);
    const shared = { profile: localProfile, siteURL, indexable, language };
    pages.push(
      [pageFile('home', language), layout({ ...shared, page: 'home', title: profile.name, description: localProfile.shortBio, content: home(localProfile, network, language) })],
      [pageFile('publications', language), layout({ ...shared, page: 'publications', title: translate(language, 'nav.publications') + ' — ' + profile.name, description: translate(language, 'meta.publications', { name: profile.name }), content: publications(data, language), data })],
      [pageFile('about', language), layout({ ...shared, page: 'about', title: translate(language, 'nav.about') + ' — ' + profile.name, description: translate(language, 'meta.about', { name: profile.name }), content: about(localProfile, language) })],
      [pageFile('contact', language), layout({ ...shared, page: 'contact', title: translate(language, 'nav.contact') + ' — ' + profile.name, description: translate(language, 'meta.contact', { name: profile.name }), content: contact(localProfile, language) })],
      [pageFile('not-found', language), layout({ ...shared, indexable: false, page: 'not-found', title: translate(language, 'notFound.title') + ' — ' + profile.name, description: translate(language, 'meta.notFound'), content: '<section class="page-title not-found"><h1>' + t(language, 'notFound.title') + '</h1><p>' + t(language, 'notFound.description') + '</p><a class="button" href="' + pageFile('home', language) + '">' + t(language, 'notFound.return') + '</a></section>' })]
    );
  }
  for (const [filename, html] of pages) await writeFile(path.join(output, filename), html);
  await writeFile(path.join(output, '.nojekyll'), '');
  await writeFile(path.join(output, 'robots.txt'), indexable && siteURL ? 'User-agent: *\nAllow: /\nSitemap: ' + siteURL + '/sitemap.xml\n' : 'User-agent: *\nDisallow: /\n');
  if (siteURL) await writeFile(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + supportedLanguages.flatMap(language => ['home', 'about', 'publications', 'contact'].map(page => '<url><loc>' + escape(new URL(pageFile(page, language), siteURL + '/').href) + '</loc></url>')).join('') + '</urlset>');
  console.log('Built ' + supportedLanguages.length * 4 + ' pages, ' + supportedLanguages.length + ' error pages, and ' + data.publications.length + ' publication cards per language.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildSite().catch(error => { console.error('Build failed: ' + error.message); process.exitCode = 1; });

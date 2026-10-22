import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validatePublicationData } from './publications.mjs';
import { comparePublications, publicationGroup, normalizeKeywords, keywordKey } from '../assets/publication-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const styleVersion = createHash('sha256').update(await readFile(path.join(root, 'assets/site.css'))).digest('hex').slice(0, 12);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const readJSON = async filename => JSON.parse(await readFile(path.join(root, filename), 'utf8'));
const contactIcons = await readJSON('content/contact-icons.json');
const statusNames = { accepted: 'Accepted', published: 'Published', preprint: 'Preprint', submitted: 'Submitted', 'under-review': 'Under review', 'in-preparation': 'In preparation' };
const safeURL = value => { if (!value) return null; try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
const dateText = value => value ? new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : '';

function authorText(authors) {
  return escape(authors).replace(/Rodrigo R\. Granjel/g, '<strong>Rodrigo R. Granjel</strong>');
}
function paperCard(paper, heading = 'h3') {
  const hasResources = publicationGroup(paper) === 'published' || paper.status === 'preprint';
  const journalDetails = [(paper.status === 'published' || paper.status === 'preprint') ? paper.year : null, paper.journal].filter(Boolean).join(' · ');
  const tags = normalizeKeywords(paper.keywords || []).map(keyword => '<a class="keyword-tag" data-keyword="' + escape(keywordKey(keyword)) + '" href="publications.html?keyword=' + encodeURIComponent(keywordKey(keyword)) + '">' + escape(keyword) + '</a>').join('');
  const title = hasResources && paper.doi ? '<a href="' + escape(paper.doi) + '" target="_blank" rel="noopener noreferrer">' + escape(paper.title) + '</a>' : escape(paper.title);
  const abstractButton = paper.abstract ? '<button class="abstract-toggle js-only" type="button" aria-expanded="false" aria-controls="abstract-' + escape(paper.id) + '">Abstract <svg class="abstract-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6L8 10L12 6"/></svg></button>' : '';
  const resources = hasResources ? [
    paper.doi ? '<button class="copy-doi js-only" type="button" data-copy-doi="' + escape(paper.doi) + '" aria-label="Copy DOI for ' + escape(paper.title) + '"><span class="copy-doi-label">DOI</span><svg class="clipboard-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><g class="clipboard-shape"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></g><path class="copy-check" d="m5 12 4 4L19 6"/></svg></button>' : '',
    paper.pdf ? '<a href="' + escape(paper.pdf) + '" target="_blank" rel="noopener noreferrer" aria-label="PDF of ' + escape(paper.title) + '">PDF <span aria-hidden="true">↗</span></a>' : ''
  ].join('') : '';
  return '<article class="paper-card" data-paper-id="' + escape(paper.id) + '"><div class="paper-body">' +
    '<div class="paper-meta"><span class="status status-' + escape(paper.status) + '">' + statusNames[paper.status] + '</span></div>' +
    '<' + heading + ' class="paper-title">' + title + '</' + heading + '><p class="paper-authors">' + authorText(paper.authors) + '</p>' +
    (journalDetails ? '<p class="paper-journal">' + escape(journalDetails) + '</p>' : '') +
    (tags ? '<div class="paper-keywords" aria-label="Keywords">' + tags + '</div>' : '') +
    (abstractButton || resources ? '<div class="paper-links">' + abstractButton + resources + '</div>' : '') +
    (paper.abstract ? '<div class="abstract-content" id="abstract-' + escape(paper.id) + '"><p>' + escape(paper.abstract) + '</p></div>' : '') +
    (hasResources && paper.doi ? '<span class="copy-status sr-only" role="status" aria-atomic="true"></span><div class="doi-manual" hidden><p>Copy this DOI link:</p><input type="text" readonly value="' + escape(paper.doi) + '" aria-label="DOI for ' + escape(paper.title) + '"></div>' : '') + '</div></article>';
}

function publicationSection(key, title, papers, open) {
  if (!papers.length) return '';
  let content;
  if (key === 'published') {
    const publishedPapers = papers.filter(paper => paper.status === 'published');
    const accepted = papers.filter(paper => paper.status === 'accepted');
    const years = [...new Set(publishedPapers.map(paper => paper.year))].sort((a, b) => (b || 0) - (a || 0));
    content = (accepted.length ? '<div class="paper-grid accepted-papers">' + accepted.map(paper => paperCard(paper)).join('') + '</div>' : '') + years.map(year => '<section class="paper-year-group" data-year-group>' +
      (year ? '<h3 class="year-heading">' + escape(year) + '</h3>' : '') +
      '<div class="paper-grid">' + publishedPapers.filter(paper => paper.year === year).map(paper => paperCard(paper, year ? 'h4' : 'h3')).join('') + '</div></section>').join('');
  } else {
    content = '<div class="paper-grid">' + papers.map(paper => paperCard(paper)).join('') + '</div>';
  }
  return '<details class="publication-section" data-publication-section="' + key + '" data-default-open="' + open + '"' + (open ? ' open' : '') + '>' +
    '<summary class="publication-section-heading"><h2>' + title + '</h2><span class="section-count" data-section-count>' + papers.length + '</span><svg class="section-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6L8 10L12 6"/></svg></summary>' +
    '<div class="publication-section-body">' + content + '</div></details>';
}

function profileLinks(profile) {
  const links = [];
  if (profile.links?.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(profile.links.email)) {
    links.push('<a href="mailto:' + escape(profile.links.email) + '"><span class="profile-link-label"><svg class="platform-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span>Email</span></span><span class="contact-email-value">' + escape(profile.links.email) + '</span></a>');
  }
  if (profile.contact?.addressLines?.length) {
    links.push('<div class="contact-address-row"><span class="profile-link-label"><svg class="platform-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span id="contact-address-label">Address</span></span><address aria-labelledby="contact-address-label">' + profile.contact.addressLines.map(escape).join('<br>') + '</address></div>');
  }
  for (const [key, label] of [['orcid', 'ORCID'], ['scholar', 'Google Scholar'], ['github', 'GitHub'], ['bluesky', 'Bluesky'], ['linkedin', 'LinkedIn']]) {
    const url = safeURL(profile.links?.[key]);
    if (!url) continue;
    const icon = contactIcons[key];
    const logo = icon ? '<svg class="platform-icon" viewBox="' + escape(icon.viewBox) + '" fill="currentColor" aria-hidden="true" focusable="false">' + icon.paths.map(d => '<path d="' + escape(d) + '"/>').join('') + '</svg>' : '';
    links.push('<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer"><span class="profile-link-label">' + logo + '<span>' + label + '</span></span><span class="profile-link-arrow" aria-hidden="true">↗</span></a>');
  }
  return links.join('');
}

function layout({ profile, page, title, description, content, data, siteURL, indexable }) {
  const file = page === 'home' ? 'index.html' : page === 'not-found' ? '404.html' : page + '.html';
  const canonical = siteURL ? new URL(file, siteURL + '/').href : null;
  const nav = [['home', 'index.html', 'Index'], ['about', 'about.html', 'About'], ['publications', 'publications.html', 'Publications'], ['contact', 'contact.html', 'Contact']]
    .map(([key, href, label]) => '<a href="' + href + '"' + (page === key ? ' aria-current="page"' : '') + '>' + label + '</a>').join('');
  const themeButton = '<button class="theme-toggle js-only" type="button" aria-label="Switch to light theme"><span data-theme-label>Light</span><span class="theme-dot" aria-hidden="true"></span></button>';
  const header = page === 'home' ?
    '<header class="site-header index-header">' + themeButton + '</header>' :
    '<header class="site-header"><a class="wordmark" href="index.html" aria-label="' + escape(profile.name) + ' — index">' + escape(profile.name) + '</a><button class="menu-toggle js-only" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span aria-hidden="true">☰</span></button><nav id="site-nav" class="site-nav" aria-label="Main navigation">' + nav + '</nav>' + themeButton + '</header>';
  return '<!doctype html>\n<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) +
    '</title><meta name="description" content="' + escape(description) + '"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="#101613"><meta name="robots" content="' +
    (indexable ? 'index,follow' : 'noindex,nofollow') + '">' +
    (canonical ? '<link rel="canonical" href="' + escape(canonical) + '">' : '') +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + escape(title) + '"><meta property="og:description" content="' + escape(description) + '">' +
    (canonical ? '<meta property="og:url" content="' + escape(canonical) + '"><meta property="og:image" content="' + escape(new URL(profile.portrait, siteURL + '/').href) + '">' : '') +
    '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/site.css?v=' + styleVersion + '">' +
    (page === 'home' ? '<link rel="stylesheet" href="assets/network.css"><script type="module" src="assets/network.js"></script>' : '') +
    '<script>try{var t=localStorage.getItem("field-notes-appearance");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}</script><script type="module" src="assets/site.js"></script></head>' +
    '<body id="top" tabindex="-1" data-page="' + page + '"><a class="skip-link" href="#main">Skip to content</a><div class="page-shell">' + header + '<main id="main">' + content + '</main><footer class="site-footer"><span>© ' + new Date().getUTCFullYear() + ' ' + escape(profile.name) + '</span>' + '<a class="back-to-top" href="#top">Back to top ↑</a>' + '</footer></div>' +
    (data ? '<script type="application/json" id="publication-data">' + safeJSON(data) + '</script>' : '') + '</body></html>';
}

function home(profile, network) {
  const keywords = (profile.researchKeywords || []).map(escape).join(' · ');
  const currentPosition = profile.career.find(item => !item.endDate);
  const institutionURL = safeURL(currentPosition?.institutionUrl);
  const institutionLabel = escape(currentPosition?.institutionShortName || currentPosition?.institution);
  const institution = institutionURL ? '<a href="' + escape(institutionURL) + '" target="_blank" rel="noopener noreferrer">' + institutionLabel + '</a>' : institutionLabel;
  return '<section class="index-intro">' + (keywords ? '<p class="eyebrow index-keywords">' + keywords + '</p>' : '') + '<h1>' + escape(profile.name) + '</h1>' +
    (currentPosition?.institution ? '<p class="index-description index-affiliation">' + escape(currentPosition.title ? currentPosition.title + ' at ' : '') + institution + '</p>' : '') + '</section>' + network;
}

function publications(data) {
  const papers = [...data.publications].sort(comparePublications);
  const years = [...new Set(papers.filter(paper => paper.status === 'published' || paper.status === 'preprint').map(paper => paper.year).filter(Boolean))].sort((a, b) => b - a);
  const journals = [...new Set(papers.map(paper => paper.journal).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const keywordMap = new Map();
  for (const paper of papers) for (const keyword of normalizeKeywords(paper.keywords || [])) keywordMap.set(keywordKey(keyword), keyword);
  const keywords = [...keywordMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const select = (id, label, options) => '<div class="filter-field"><label for="' + id + '">' + label + '</label><select id="' + id + '"><option value="all">All</option>' + options.map(([value, text]) => '<option value="' + escape(value) + '">' + escape(text) + '</option>').join('') + '</select></div>';
  return '<section class="page-title publications-title"><h1>Publications</h1></section><section class="publication-library" aria-label="Publication explorer">' +
    '<div class="results-heading"><button type="button" class="filters-toggle js-only" id="toggle-filters" aria-expanded="false" aria-controls="publication-filters"><span>Filters</span><span id="active-filter-count" class="filter-count" hidden></span><svg class="filters-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4.5L6 7.5L9 4.5"/></svg></button><p id="results-count" role="status" aria-live="polite">' + papers.length + ' entries</p></div><form class="publication-controls js-only" role="search" id="publication-filters" hidden><div class="search-field"><label for="paper-search" class="sr-only">Search publications</label><input id="paper-search" name="q" type="search" maxlength="200" placeholder="Search title, author or keyword" autocomplete="off"></div><div class="select-fields">' +
    select('paper-year', 'Year', years.map(year => [year, year])) +
    select('paper-status', 'Status', [['in-preparation', 'In preparation'], ['submitted', 'Submitted'], ['under-review', 'Under review'], ['accepted', 'Accepted'], ['published', 'Published'], ['preprint', 'Preprint']].filter(([status]) => papers.some(paper => paper.status === status))) +
    select('paper-journal', 'Journal', journals.map(journal => [journal, journal])) +
    select('paper-keyword', 'Keyword', keywords) +
    '</div><button type="button" class="reset-filters" id="reset-filters">Clear filters</button></form>' +
    '<div id="paper-list">' + publicationSection('preparation', 'In preparation', papers.filter(paper => publicationGroup(paper) === 'preparation'), false) + publicationSection('submitted', 'Submitted &amp; Under review', papers.filter(paper => publicationGroup(paper) === 'submitted'), true) + publicationSection('preprints', 'Preprints', papers.filter(paper => publicationGroup(paper) === 'preprints'), true) + publicationSection('published', 'Published', papers.filter(paper => publicationGroup(paper) === 'published'), true) + '</div>' +
    '<div id="empty-results" class="empty-results"' + (papers.length ? ' hidden' : '') + '><h2>No matching publications</h2><p>Try another keyword or clear the filters.</p><button type="button" class="button" id="reset-empty">Clear filters</button></div>' +
    '<noscript><p class="snapshot-note">All publications are shown. Enable JavaScript to filter them.</p></noscript></section>';
}

function about(profile) {
  return '<section class="page-title"><h1>About</h1></section><section class="biography"><figure class="portrait-figure"><img src="' + escape(profile.portrait) + '" alt="' + escape(profile.name) +
    '" width="800" height="601"></figure><div class="biography-copy">' + (profile.biography || [profile.shortBio]).map(paragraph => '<p>' + escape(paragraph) + '</p>').join('') +
    '</div></section>' +
    '<section class="career-section"><h2>Experience &amp; education</h2><ol class="career-list">' + [...profile.career].sort((a, b) => b.startDate.localeCompare(a.startDate)).map(item => {
      const institutionURL = safeURL(item.institutionUrl);
      return '<li><div class="career-date">' + escape(item.dateLabel || (dateText(item.startDate) + (item.endDate ? ' — ' + dateText(item.endDate) : ''))) +
        '</div><div><h3>' + escape(item.title) + '</h3><p class="career-institution">' + (institutionURL ? '<a href="' + escape(institutionURL) + '" target="_blank" rel="noopener noreferrer">' + escape(item.institution) + '</a>' : escape(item.institution)) +
        '</p>' + (item.location ? '<p class="career-place">' + escape(item.location) + '</p>' : '') + '</div></li>';
    }).join('') + '</ol></section>';
}

function contact(profile) {
  return '<section class="page-title"><h1>Contact</h1></section><section class="contact-page"><div class="profile-links">' + profileLinks(profile) + '</div></section>';
}

export async function buildSite() {
  const siteConfig = await readJSON('content/site.json');
  const profile = await readJSON('content/profile.json');
  const raw = await readJSON('content/publications.json');
  const validated = validatePublicationData(raw);
  // Draft projects are excluded before rendering or embedding browser-visible records.
  // Target journals are private: omit them from both rendered cards and browser data.
  const data = { ...validated, publications: validated.publications
    .filter(paper => publicationGroup(paper) !== 'preparation')
    .map(paper => publicationGroup(paper) === 'submitted' ? { ...paper, journal: null } : paper) };
  const network = await readFile(path.join(root, 'templates/index-network.html'), 'utf8');
  for (const required of ['name', 'shortBio', 'portrait', 'career']) if (!profile[required]) throw new Error('Missing profile field: ' + required);
  const configuredURL = safeURL(process.env.SITE_URL || siteConfig.url);
  const siteURL = configuredURL ? configuredURL.replace(/\/$/, '') : null;
  const indexable = process.env.SITE_ALLOW_INDEXING === 'true';
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(output)) await rm(path.join(output, entry), { recursive: true, force: true });
  await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
  const shared = { profile, siteURL, indexable };
  const pages = [
    ['index.html', layout({ ...shared, page: 'home', title: profile.name, description: profile.shortBio, content: home(profile, network) })],
    ['publications.html', layout({ ...shared, page: 'publications', title: 'Publications — ' + profile.name, description: 'Papers and manuscripts by ' + profile.name + '.', content: publications(data), data })],
    ['about.html', layout({ ...shared, page: 'about', title: 'About — ' + profile.name, description: 'Research background of ' + profile.name + '.', content: about(profile) })],
    ['contact.html', layout({ ...shared, page: 'contact', title: 'Contact — ' + profile.name, description: 'Contact and profiles for ' + profile.name + '.', content: contact(profile) })],
    ['404.html', layout({ ...shared, indexable: false, page: 'not-found', title: 'Page not found — ' + profile.name, description: 'Page not found.', content: '<section class="page-title not-found"><h1>Page not found</h1><p>The page you requested is unavailable.</p><a class="button" href="index.html">Return to index</a></section>' })]
  ];
  for (const [filename, html] of pages) await writeFile(path.join(output, filename), html);
  await writeFile(path.join(output, '.nojekyll'), '');
  await writeFile(path.join(output, 'robots.txt'), indexable && siteURL ? 'User-agent: *\nAllow: /\nSitemap: ' + siteURL + '/sitemap.xml\n' : 'User-agent: *\nDisallow: /\n');
  if (siteURL) await writeFile(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['index.html', 'about.html', 'publications.html', 'contact.html'].map(file => '<url><loc>' + escape(new URL(file, siteURL + '/').href) + '</loc></url>').join('') + '</urlset>');
  console.log('Built 4 pages, a 404 page, and ' + data.publications.length + ' publication cards.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildSite().catch(error => { console.error('Build failed: ' + error.message); process.exitCode = 1; });

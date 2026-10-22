import { keywordKey, normalizeKeyword } from './publication-utils.js';

document.documentElement.classList.add('has-js');
const themeButton = document.querySelector('.theme-toggle');
function updateThemeLabel() {
  if (!themeButton) return;
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  themeButton.setAttribute('aria-label', 'Switch to ' + next + ' theme');
  themeButton.querySelector('[data-theme-label]').textContent = next === 'dark' ? 'Dark' : 'Light';
}
themeButton?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('field-notes-appearance', next); } catch (_) {}
  updateThemeLabel();
});
updateThemeLabel();

const menu = document.querySelector('.menu-toggle');
const nav = document.getElementById('site-nav');
function closeMenu() {
  menu?.setAttribute('aria-expanded', 'false');
  nav?.classList.remove('is-open');
}
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
});
nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

const footer = document.querySelector('.site-footer');
const backToTop = footer?.querySelector('.back-to-top');
if (footer && backToTop) {
  function updateFooterHeight() {
    const height = Math.ceil(footer.getBoundingClientRect().height);
    if (height) document.documentElement.style.setProperty('--footer-height', height + 'px');
  }
  function updateBackToTop() {
    backToTop.classList.toggle('is-visible', window.scrollY > 100);
  }
  backToTop.addEventListener('click', event => {
    event.preventDefault();
    document.getElementById('top').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  window.addEventListener('scroll', updateBackToTop, { passive: true });
  window.addEventListener('pageshow', updateBackToTop);
  window.addEventListener('resize', updateFooterHeight, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(updateFooterHeight).observe(footer);
  updateFooterHeight();
  updateBackToTop();
}

document.querySelectorAll('.abstract-toggle').forEach(button => {
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (!panel) return;
  panel.hidden = true;
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    panel.hidden = !expanded;
  });
});

function legacyCopy(value) {
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const input = document.createElement('textarea');
  input.value = value;
  input.readOnly = true;
  input.tabIndex = -1;
  input.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
  document.body.append(input);
  try {
    input.select();
    return document.execCommand('copy');
  } catch (_) {
    return false;
  } finally {
    input.remove();
    active?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}

document.querySelectorAll('[data-copy-doi]').forEach(button => {
  const card = button.closest('.paper-card');
  const status = card.querySelector('.copy-status');
  const manual = card.querySelector('.doi-manual');
  let resetTimer;
  let copying = false;
  button.addEventListener('click', async () => {
    if (copying) return;
    copying = true;
    window.clearTimeout(resetTimer);
    status.textContent = '';
    button.classList.remove('is-copied');
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(button.dataset.copyDoi);
        copied = true;
      }
    } catch (_) {}
    if (!copied) copied = legacyCopy(button.dataset.copyDoi);
    copying = false;
    if (copied) {
      manual.hidden = true;
      button.classList.add('is-copied');
      status.textContent = 'DOI copied to clipboard.';
      resetTimer = window.setTimeout(() => {
        button.classList.remove('is-copied');
      }, 1800);
    } else {
      manual.hidden = false;
      status.textContent = 'Automatic copying is unavailable. Select and copy the DOI link below.';
      const input = manual.querySelector('input');
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      input.select();
    }
  });
});

const embedded = document.getElementById('publication-data');
if (embedded) {
  const data = JSON.parse(embedded.textContent).publications;
  const records = new Map(data.map(paper => [paper.id, paper]));
  const list = document.getElementById('paper-list');
  const articles = Array.from(list.querySelectorAll('[data-paper-id]'));
  const sections = Array.from(list.querySelectorAll('[data-publication-section]'));
  const yearGroups = Array.from(list.querySelectorAll('[data-year-group], .accepted-papers'));
  const filterPanel = document.getElementById('publication-filters');
  const filterToggle = document.getElementById('toggle-filters');
  const activeFilterCount = document.getElementById('active-filter-count');
  function setFiltersOpen(open) {
    filterPanel.hidden = !open;
    filterToggle.setAttribute('aria-expanded', String(open));
  }
  filterToggle.addEventListener('click', () => setFiltersOpen(filterPanel.hidden));
  setFiltersOpen(false);
  const search = document.getElementById('paper-search');
  const year = document.getElementById('paper-year');
  const status = document.getElementById('paper-status');
  const journal = document.getElementById('paper-journal');
  const keyword = document.getElementById('paper-keyword');
  const selects = [year, status, journal, keyword];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  function setSelect(control, value) {
    control.value = Array.from(control.options).some(option => option.value === value) ? value : 'all';
  }
  function loadURL() {
    const params = new URLSearchParams(window.location.search);
    search.value = (params.get('q') || '').slice(0, 200);
    setSelect(year, params.get('year'));
    setSelect(status, params.get('status'));
    setSelect(journal, params.get('journal'));
    setSelect(keyword, params.get('keyword') ? keywordKey(normalizeKeyword(params.get('keyword'))) : null);
    filter(false);
  }
  function filter(updateURL = true) {
    const terms = normalize(search.value).trim().split(/\s+/).filter(Boolean);
    const keywordQuery = keywordKey(normalizeKeyword(search.value));
    let count = 0;
    articles.forEach(article => {
      const paper = records.get(article.dataset.paperId);
      const words = paper.keywords || [];
      const haystack = normalize([paper.title, paper.authors, paper.journal, paper.abstract, ...words].join(' '));
      const textMatch = terms.every(term => haystack.includes(term)) || (keywordQuery && words.some(word => keywordKey(word) === keywordQuery));
      const visible = textMatch &&
        (status.value === 'all' || paper.status === status.value) &&
        (year.value === 'all' || ((paper.status === 'published' || paper.status === 'preprint') && String(paper.year) === year.value)) &&
        (journal.value === 'all' || paper.journal === journal.value) &&
        (keyword.value === 'all' || words.some(word => keywordKey(word) === keyword.value));
      article.hidden = !visible;
      if (visible) count++;
    });
    const activeCount = Number(!!search.value.trim()) + selects.filter(control => control.value !== 'all').length;
    const filtering = activeCount > 0;
    activeFilterCount.hidden = !filtering;
    activeFilterCount.textContent = '(' + activeCount + ')';
    filterToggle.setAttribute('aria-label', filtering ? 'Filters (' + activeCount + ' active)' : 'Filters');
    yearGroups.forEach(group => {
      group.hidden = !Array.from(group.querySelectorAll('[data-paper-id]')).some(article => !article.hidden);
    });
    sections.forEach(section => {
      const matches = Array.from(section.querySelectorAll('[data-paper-id]')).filter(article => !article.hidden).length;
      section.querySelector('[data-section-count]').textContent = matches;
      section.hidden = matches === 0;
      section.open = filtering ? matches > 0 : section.dataset.defaultOpen === 'true';
    });
    document.getElementById('results-count').textContent = count === data.length ? count + ' entries' : count + ' of ' + data.length + ' entries';
    document.getElementById('empty-results').hidden = count !== 0;
    document.getElementById('reset-filters').disabled = !search.value && selects.every(control => control.value === 'all');
    if (updateURL) {
      const params = new URLSearchParams();
      if (search.value.trim()) params.set('q', search.value.trim());
      for (const [name, control] of [['year', year], ['status', status], ['journal', journal], ['keyword', keyword]]) {
        if (control.value !== 'all') params.set(name, control.value);
      }
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    }
  }
  function reset() {
    search.value = '';
    selects.forEach(control => { control.value = 'all'; });
    filter();
  }
  document.getElementById('publication-filters').addEventListener('submit', event => { event.preventDefault(); filter(); });
  search.addEventListener('input', () => filter());
  selects.forEach(control => control.addEventListener('change', () => filter()));
  document.querySelectorAll('[data-keyword]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    setSelect(keyword, link.dataset.keyword);
    filter();
    setFiltersOpen(true);
    filterPanel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    keyword.focus({ preventScroll: true });
  }));
  document.getElementById('reset-filters').addEventListener('click', reset);
  document.getElementById('reset-empty').addEventListener('click', () => { reset(); setFiltersOpen(true); search.focus(); });
  window.addEventListener('popstate', loadURL);
  loadURL();
}

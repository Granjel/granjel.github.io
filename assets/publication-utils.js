// Shared publication filtering, keyword normalization, and ordering.
const KEYWORD_ALIASES = new Map([
  ['co existence', 'Coexistence'], ['coexistence', 'Coexistence'],
  ['doc', 'Dissolved organic carbon'], ['dissolved organic carbon', 'Dissolved organic carbon'],
  ['voc', 'Volatile organic compounds'], ['vocs', 'Volatile organic compounds'],
  ['volatile organic compound', 'Volatile organic compounds'], ['volatile organic compounds', 'Volatile organic compounds'],
  ['volatile organic compounds (vocs)', 'Volatile organic compounds'],
  ['grassland', 'Grasslands'], ['grasslands', 'Grasslands'],
  ['inner mongolian plateau', 'Inner Mongolian Plateau'], ['qinghai tibetan plateau', 'Qinghai-Tibetan Plateau'],
  ['plant insect interactions', 'Plant–insect interactions'],
  ['plant plant interactions', 'Plant–plant interactions'], ['plant plant signalling', 'Plant–plant signalling'],
  ['herbivore induced defences', 'Herbivore-induced defences'],
  ['higher order interactions', 'Higher-order interactions'], ['life history traits', 'Life-history traits'],
  ['species interaction', 'Species interactions'], ['species interactions', 'Species interactions'],
  ['biotic interaction', 'Biotic interactions'], ['biotic interactions', 'Biotic interactions'],
  ['plant herbivore interaction', 'Plant–herbivore interactions'], ['plant herbivore interactions', 'Plant–herbivore interactions'],
  ['plant soil feedback', 'Plant–soil feedbacks'], ['plant soil feedbacks', 'Plant–soil feedbacks'],
  ['plant pathogen', 'Plant pathogens'], ['plant pathogens', 'Plant pathogens'],
  ['fungal pathogen', 'Fungal pathogens'], ['fungal pathogens', 'Fungal pathogens'],
  ['microbial community', 'Microbial communities'], ['microbial communities', 'Microbial communities'],
  ['stabilising mechanism', 'Stabilizing mechanisms'], ['stabilising mechanisms', 'Stabilizing mechanisms'],
  ['stabilizing mechanism', 'Stabilizing mechanisms'], ['stabilizing mechanisms', 'Stabilizing mechanisms'],
  ['edna', 'eDNA'], ['dna', 'DNA'], ['rna', 'RNA'],
]);
const KEYWORD_ACRONYMS = new Map([['edna', 'eDNA'], ['dna', 'DNA'], ['rna', 'RNA'], ['doc', 'DOC'], ['soc', 'SOC'], ['dic', 'DIC'], ['voc', 'VOC'], ['vocs', 'VOCs'], ['npp', 'NPP'], ['anpp', 'ANPP'], ['cwm', 'CWM'], ['co2', 'CO2'], ['ch4', 'CH4']]);

export function keywordKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en')
    .replace(/[-\u2010-\u2015]+/gu, ' ').replace(/\s+/gu, ' ');
}

export function normalizeKeyword(value) {
  const key = keywordKey(value);
  if (!key) return '';
  // Only listed equivalents are merged; e.g. biotic and species interactions stay distinct.
  const alias = KEYWORD_ALIASES.get(key);
  if (alias) return alias;
  const label = key.replace(/\b(?:edna|dna|rna|doc|soc|dic|voc|vocs|npp|anpp|cwm|co2|ch4)\b/gu, (word) => KEYWORD_ACRONYMS.get(word));
  return label.startsWith('eDNA') ? label : label[0].toLocaleUpperCase('en') + label.slice(1);
}

export function normalizeKeywords(values = []) {
  return [...new Set(values.map(normalizeKeyword).filter(Boolean))];
}

const PUBLICATION_STATUS_ALIASES = new Map([
  ['in-revision', 'under-review'],
  ['writing', 'in-preparation'], ['analysis', 'in-preparation'],
  ['data-ready', 'in-preparation'], ['data-collection', 'in-preparation'],
]);

export function normalizePublicationStatus(value) {
  const status = String(value ?? '').trim().toLowerCase().replace(/[ _]+/gu, '-');
  return PUBLICATION_STATUS_ALIASES.get(status) || status;
}

export function isOngoing(paper) {
  return paper.status === 'submitted' || paper.status === 'under-review';
}

export function publicationGroup(paper) {
  if (paper.status === 'in-preparation') return 'preparation';
  if (isOngoing(paper)) return 'submitted';
  if (paper.status === 'preprint') return 'preprints';
  return 'published';
}

function authorIdentity(value) {
  let name = String(value ?? '').trim().replace(/^and\s+/iu, '').replace(/[\s*†‡]+$/gu, '');
  if (name.includes(',')) {
    const [surname, ...given] = name.split(',');
    name = given.join(' ').trim() + ' ' + surname.trim();
  }
  return name.normalize('NFKC').toLocaleLowerCase('en').replace(/\./gu, '').replace(/\s+/gu, ' ').trim();
}

export function isPreparationEligible(paper, researcher = 'Rodrigo R. Granjel') {
  const authors = String(paper.authors ?? '').trim();
  const abbreviatedTail = authors.match(/(?:,\s*|\s+)and\s+\d+\s+additional\s+coauthors\.?$/iu);
  const listedAuthors = abbreviatedTail ? authors.slice(0, abbreviatedTail.index).trim() : authors;
  const parts = listedAuthors.includes(';') ? listedAuthors.split(';')
    : listedAuthors.includes(',') ? listedAuthors.split(',')
      : listedAuthors.split(/\s+and\s+/iu);
  const names = parts.map(authorIdentity).filter(Boolean);
  const owner = authorIdentity(researcher);
  if (owner && !abbreviatedTail && authorIdentity(listedAuthors) === owner) return true;
  if (!owner || !names.includes(owner)) return false;
  return names[0] === owner || (!abbreviatedTail && names.at(-1) === owner) || paper.coFirstAuthor === true;
}

const GROUP_ORDER = { preparation: 0, submitted: 1, preprints: 2, published: 3 };

function chronologicalValue(paper) {
  if (paper.date) return Number(paper.date.replaceAll('-', ''));
  return paper.year == null ? null : Number(paper.year) * 10000;
}

function stableTie(a, b) {
  return String(a.title).localeCompare(String(b.title), 'en', { sensitivity: 'base' })
    || String(a.id).localeCompare(String(b.id), 'en');
}

export function comparePublications(a, b, sort = 'default') {
  if (sort === 'title') return stableTie(a, b);
  const aDate = chronologicalValue(a);
  const bDate = chronologicalValue(b);
  if (sort === 'default') {
    const groupDifference = GROUP_ORDER[publicationGroup(a)] - GROUP_ORDER[publicationGroup(b)];
    if (groupDifference) return groupDifference;
    // The source array follows spreadsheet row order; stable sort retains it for preparation.
    if (publicationGroup(a) === 'preparation') return 0;
  }
  // Undated submissions remain visible at the top, without inventing a year.
  const aUndatedOngoing = aDate === null && isOngoing(a);
  const bUndatedOngoing = bDate === null && isOngoing(b);
  if (aUndatedOngoing !== bUndatedOngoing) return aUndatedOngoing ? -1 : 1;
  if (aDate === null || bDate === null) {
    if (aDate !== bDate) return aDate === null ? 1 : -1;
    return sort === 'default' ? 0 : stableTie(a, b);
  }
  return (sort === 'oldest' ? aDate - bDate : bDate - aDate) || (sort === 'default' ? 0 : stableTie(a, b));
}

# Rodrigo R. Granjel

Live website: [granjel.github.io](https://granjel.github.io/).

Research website with four independent pages: Index, About, Publications, and Contact. Built with plain JavaScript and served as static files by GitHub Pages.

## Edit content

- `content/site.json`: public site URL and Google Search Console verification token. Keep the verification token after ownership is verified.
- `content/profile.json`: introduction, biography, career, email, address, and profile links. Each career entry has a stable `id` and a `category` of `experience` or `education`, which places it in the corresponding About section. Translation overrides can use the entry ID so separate roles at the same institution keep their own titles and dates; existing institution-URL overrides remain supported.
- `content/publications.json`: automatically generated public snapshot from the private Google Sheet; edit the Sheet instead.
- `assets/papers/`: PDFs publicly hosted alongside the website.
- `assets/portrait.jpg`: About portrait.

Only information intended for the website belongs here. Only papers selected in the Sheet are included. Unpublished target journals, the private spreadsheet, and credentials are excluded. The workflow reads the private Sheet on pushes/manual runs and requests a check every 5 minutes. GitHub schedules can be delayed or skipped. Failed imports stop publication and preserve the current live website.

## Languages

English, Spanish (Spain) and Galician share the same templates. The language menu beside the theme button switches to the matching page, preserves publication filters, and remembers the visitor's choice. Spanish and Galician pages use the .es.html and .gl.html suffixes. All language links also work without JavaScript.

- `assets/i18n.js`: interface labels, accessibility text and messages in all three languages.
- `content/profile.es.json` and `content/profile.gl.json`: Spanish and Galician biography, career descriptions and address wording; proper names and links come from the original profile.
- Publication titles, authors, journals, keywords and abstracts stay exactly as recorded in the Sheet in all three languages.

## Develop

Use Node.js 22 or later. No package installation is required.

```sh
npm run dev
```

Checks and production build:

```sh
npm test
npm run build
npm run check
```

Generated files are written to `dist/` and ignored by Git.

## Deploy

The **Publish website** GitHub Actions workflow builds, checks, and publishes `dist/` on every push to `main`. It can also run manually from Actions. GitHub Pages must use **GitHub Actions** as its publishing source. The Pages configuration supplies the correct URL to the build, for this repository.

The website is public; the repository can remain private if the GitHub account supports Pages for private repositories.

A manuscript can carry a companion preprint DOI while keeping its current status and one card. A standalone Preprint card is created only when status is preprint. Review proofs and target journal names stay out of the public repository.

## Publication Sheet columns

Keep the existing headers and edit these cells:

- `website`: yes includes the row at any stage; no or blank excludes it. Checkboxes also work. Selected preparation projects appear in the collapsed In preparation section, with no author-position restriction.
- `status`: published, accepted, preprint, submitted, under review or in revision. In revision maps to Under review. Writing, analysis, data ready and data collection appear as In preparation when selected. The old preprint yes/no column does not override status.
- `id`: stable unique identifier; keep existing IDs unchanged.
- `title`, `authors`, `journal`, `year`: current metadata. Journal and year are suppressed for preparation and submitted/review manuscripts. Accepted papers have no inferred year.
- `paper_doi`: current version's DOI. A bare DOI or doi.org URL works.
- `code_doi`: creates a Code link only when filled. A bare DOI, doi.org URL or explicit HTTPS link works. Leave blank to hide the button; git_repo_link is ignored by the website.
- `data_doi`: creates a Data link. Bare DOIs, doi.org URLs and HTTPS repository links work. Empty links hide the corresponding buttons; the availability yes/no flags do not override them. Code and Data links can also appear on preparation and submitted/review cards when supplied.
- `preprint_doi`: optional Preprint link on the same card. No separate title or duplicate row is required. For a standalone preprint this supplies its DOI if paper_doi is blank.
- `pdf`: relative path such as assets/papers/2020-juan-ovejero-geoderma.pdf. Upload that file first; leave blank for no PDF button.
- `keywords`: semicolon-separated phrases, or commas if there are no semicolons.
- `abstract`: optional full abstract. Use *Arabidopsis thaliana* for italics and **text** for bold. Raw HTML is escaped. Abstracts are not fetched automatically.

Optional publication_date stores an exact date in YYYY-MM-DD format; it does not override spreadsheet order. When this column is absent, a previously approved date is retained for the same DOI and year; an explicit blank clears it. co_first_author can explicitly record equal first authorship; second author alone never implies it. Years appear newest first. The Sheet lists earlier papers first; the website reverses that row order within each year and throughout the preparation and submitted/review sections, so later papers appear first. Publication dates do not reorder cards within a year.

Private tracker columns such as notes, correspondence, funding and rejection history are not requested as data columns or exported. The service account is nevertheless a Viewer of the entire workbook. Raw Sheet/CSV data and credentials are never committed or included in dist.

### Books and chapters

Use the separate books-and-chapters tab. Column order does not matter; blank unused columns are ignored.

- Required headers: website (or show_on_website), type, status, book_title, chapter_title and authors. Keep chapter_title blank for whole books. Only rows with website set to yes are published.
- type: book chapter or book. A chapter uses chapter_title as its card title; a whole book uses book_title.
- id: stable identifier unique across both tabs. year, keywords, abstract and pdf work as for journal articles.
- book_title, editors, publisher, pages and isbn: bibliographic details; optional details can be blank. Book titles appear in the journal accent colour with the publisher in parentheses. Editors appear below; page ranges are retained in the data but hidden on cards. ISBNs appear at the top right with a copy control; books without an ISBN use their DOI there when available.
- doi: optional DOI. url: an HTTPS landing page (such as Dialnet), used for the title link when there is no DOI. Do not put a Dialnet URL in doi.
- language: original title language, such as es, gl or en; defaults to en. The abstract is displayed as supplied.

Published books and chapters join Published under their year. The journal filter remains for journal articles; search also covers book titles, editors, publishers and ISBNs. Both tabs use the existing oldest-first row convention; the site reverses row order within a year. No extra section is created.

### Connection and automatic updates

Repository Actions secrets GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SHEET_ID authenticate the dedicated service account. It needs Viewer access to the spreadsheet and the Google Sheets API enabled. Authentication uses only spreadsheets.readonly, with no domain-wide delegation and no Drive connector.

The importer reads journal articles from the unique tab with website, status, title and authors headers (normally journal-articles). If several journal tabs match, set the repository Actions variable GOOGLE_SHEET_TAB to the journal tab's exact name. It also reads the optional books-and-chapters tab by its exact name, even when GOOGLE_SHEET_TAB is set. An empty books-and-chapters tab is allowed; a populated one must have the required headers. show_on_website is accepted instead of website. Neither tab is edited by the sync.

Only changed public snapshots create data commits. If main has had no commits for 45 days, the workflow makes one empty maintenance commit to prevent GitHub's 60-day inactivity rule from disabling scheduled updates. Unchanged scheduled checks skip deployment. To publish sooner, use Actions → Publish website → Run workflow.

To preview a downloaded CSV without changing the snapshot, run npm run sync:publications -- --csv /path/to/papers.csv --dry-run. Omit --dry-run to replace the local public snapshot. For an authenticated live import, npm run sync:publications reads the environment settings above. Keep credentials and raw CSVs outside the checkout.

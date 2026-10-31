# Rodrigo R. Granjel

Live website: [granjel.github.io](https://granjel.github.io/).

Research website with four independent pages: Index, About, Publications, and Contact. Built with plain JavaScript and served as static files by GitHub Pages.

## Edit content

- `content/profile.json`: introduction, biography, career, email, address, and profile links.
- `content/publications.json`: automatically generated public snapshot from the private Google Sheet; edit the Sheet instead.
- `assets/papers/`: PDFs publicly hosted alongside the website.
- `assets/portrait.jpg`: About portrait.

Only information intended for the website belongs here. Draft projects, submitted target journals, the private spreadsheet, and credentials are excluded. The workflow reads the private Sheet on pushes/manual runs and requests a check every 5 minutes. GitHub schedules can be delayed or skipped. Failed imports stop publication and preserve the current live website.

## Languages

English and Spanish (Spain) share the same templates. The language control beside the theme button switches to the matching page, preserves publication filters, and remembers the visitor's choice. Spanish pages use the .es.html suffix and also work without JavaScript.

- `assets/i18n.js`: interface labels, accessibility text and messages in both languages.
- `content/profile.es.json`: Spanish biography, career descriptions and address wording; proper names and links come from the original profile.
- Publication titles, authors, journals, keywords and abstracts stay exactly as recorded in the Sheet in both languages.

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

For a design update while a Sheet entry needs correcting, run the workflow manually with **use_saved_publications** enabled. That one run uses the last approved public snapshot; scheduled imports retain their normal validation.

A manuscript can carry a companion preprint DOI while keeping its current status and one card. A standalone Preprint card is created only when status is preprint. Review proofs and target journal names stay out of the public repository.

## Publication Sheet columns

Keep the existing headers and edit these cells:

- `website`: yes includes the row; no or blank excludes it. Checkboxes also work. Preparation remains hidden even when selected.
- `status`: published, accepted, preprint, submitted, under review or in revision. In revision maps to Under review. Other tracker stages stay in preparation and are hidden. The old preprint yes/no column does not override status.
- `id`: stable unique identifier; keep existing IDs unchanged.
- `title`, `authors`, `journal`, `year`: current metadata. Journal and year are suppressed for submitted/review manuscripts. Accepted papers have no inferred year.
- `paper_doi`: current version's DOI. A bare DOI or doi.org URL works.
- `code_doi`: creates a Code link only when filled. A bare DOI, doi.org URL or explicit HTTPS link works. Leave blank to hide the button; git_repo_link is ignored by the website.
- `data_doi`: creates a Data link. Bare DOIs, doi.org URLs and HTTPS repository links work. Empty links hide the corresponding buttons; the availability yes/no flags do not override them. Code and Data links can also appear on submitted/review cards when supplied.
- `preprint_doi`: optional Preprint link on the same card. No separate title or duplicate row is required. For a standalone preprint this supplies its DOI if paper_doi is blank.
- `pdf`: relative path such as assets/papers/2020-juan-ovejero-geoderma.pdf. Upload that file first; leave blank for no PDF button.
- `keywords`: semicolon-separated phrases, or commas if there are no semicolons.
- `abstract`: optional full abstract. Use *Arabidopsis thaliana* for italics and **text** for bold. Raw HTML is escaped. Abstracts are not fetched automatically.

Optional publication_date stores an exact date in YYYY-MM-DD format; it does not override spreadsheet order. When this column is absent, a previously approved date is retained for the same DOI and year; an explicit blank clears it. co_first_author can explicitly record equal first authorship; second author alone never implies it. Years appear newest first. The Sheet lists earlier papers first; the website reverses that row order within each year and throughout the submitted/review section, so later papers appear first. Publication dates do not reorder cards within a year.

Private tracker columns such as notes, correspondence, funding and rejection history are not requested as data columns or exported. The service account is nevertheless a Viewer of the entire workbook. Raw Sheet/CSV data and credentials are never committed or included in dist.

### Connection and automatic updates

Repository Actions secrets GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SHEET_ID authenticate the dedicated service account. It needs Viewer access to the spreadsheet and the Google Sheets API enabled. Authentication uses only spreadsheets.readonly, with no domain-wide delegation and no Drive connector.

The importer finds the unique tab with website, status, title and authors headers. If several tabs match, set the repository Actions variable GOOGLE_SHEET_TAB to the intended tab's exact name. show_on_website is accepted instead of website.

Only changed public snapshots create data commits. If main has had no commits for 45 days, the workflow makes one empty maintenance commit to prevent GitHub's 60-day inactivity rule from disabling scheduled updates. Unchanged scheduled checks skip deployment. To publish sooner, use Actions → Publish website → Run workflow.

To preview a downloaded CSV without changing the snapshot, run npm run sync:publications -- --csv /path/to/papers.csv --dry-run. Omit --dry-run to replace the local public snapshot. For an authenticated live import, npm run sync:publications reads the environment settings above. Keep credentials and raw CSVs outside the checkout.

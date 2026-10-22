# Rodrigo R. Granjel

Live website: [granjel.github.io](https://granjel.github.io/).

Research website with four independent pages: Index, About, Publications, and Contact. Built with plain JavaScript and served as static files by GitHub Pages.

## Edit content

- `content/profile.json`: introduction, biography, career, email, address, and profile links.
- `content/publications.json`: the reviewed publication snapshot, including keywords, abstracts, DOI and PDF links.
- `assets/papers/`: the four PDFs currently linked from publication cards.
- `assets/portrait.jpg`: About portrait.

Only information intended for the website belongs here. Draft projects, submitted target journals, the private spreadsheet, and credentials are excluded. Google Sheet synchronisation is not configured; the live website currently uses this saved snapshot.

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

# PARA - Personal Knowledge Management

A server-side rendered (SSR) web application for browsing and managing a markdown vault stored in S3, organized using the PARA method.

## Features

- **PARA Method Organization**: Browse Projects, Areas, Resources, and Archives
- **Task Management**: View active tasks with urgency-based sorting, dedicated task page with sidebar
- **Search**: Search note titles and paths (metadata only, not content)
- **Syntax Highlighting**: Code blocks rendered with highlight.js
- **Image Proxy**: Private S3 bucket with secure image serving via Worker proxy
- **Pinned Folders**: Mark frequently accessed folders for quick access
- **Table of Contents**: Auto-generated TOC for documents with headings
- **Dark/Light Theme**: Toggle between light, dark, and system themes
- **Mobile Responsive**: Works on all device sizes

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Cloudflare    │────▶│   Astro SSR      │────▶│   S3 Bucket     │
│   Workers       │     │   (This Code)    │     │   Private Vault │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Image Proxy     │
                        │  /api/img/*      │
                        └──────────────────┘
```

## Tech Stack

- **Framework**: [Astro](https://astro.build/) with SSR
- **Adapter**: [@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- **Styling**: Tailwind CSS v4 with Typography plugin
- **Markdown**: unified.js with remark/rehype plugins
- **Syntax Highlighting**: highlight.js (pure JS, works in Workers)
- **S3 Client**: aws4fetch (compatible with Cloudflare Workers)

## Project Structure

```
.
├── src/
│   ├── components/          # Astro components (Sidebar, TOC, TaskList, etc.)
│   ├── layouts/             # Page layouts (Layout, DocLayout)
│   ├── lib/
│   │   ├── s3.ts           # S3 operations (list, fetch, pins)
│   │   ├── tasks.ts        # Task parsing and filtering
│   │   ├── markdown.ts     # Markdown rendering with image proxy
│   │   └── pin-toggle.ts   # Client-side pin/unpin logic
│   ├── pages/
│   │   ├── api/
│   │   │   ├── search.ts   # Search endpoint
│   │   │   ├── pin.ts      # Pin/unpin API
│   │   │   └── img/        # Image proxy endpoint
│   │   ├── index.astro     # Homepage
│   │   ├── [section]/      # PARA sections (projects, areas, etc.)
│   │   └── tasks/          # Task management pages
│   └── styles/
│       └── global.css      # Tailwind + custom styles
├── .env                    # Environment variables (not in git)
├── wrangler.toml          # Cloudflare Workers config
└── astro.config.mjs       # Astro configuration
```

## Environment Variables

Create a `.env` file in the project root:

```env
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=my-bucket
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1
```

**Important**: These credentials are inlined at build time by Astro's Cloudflare adapter. The bucket should be private — images are served through the `/api/img/*` proxy endpoint using these credentials.

## S3 Bucket Structure

Your S3 bucket should follow this structure:

```
my-bucket/
├── 1. Projects/           # Projects folder
│   └── Project_Name/
│       ├── note.md
│       └── image.jpg
├── 2. Areas/              # Areas of responsibility
├── 3. Resources/          # Reference materials
├── 4. Archives/           # Completed/inactive items
├── TaskNotes/
│   ├── Tasks/             # Task markdown files
│   └── Views/             # Task view configurations
└── _attachments/          # Global attachments
```

### Task File Format

Task files are markdown with YAML frontmatter:

```yaml
---
status: todo          # todo, in-progress, done
priority: normal      # none, low, normal, high
tags:
  - task
  - project-name
dateCreated: 2026-04-19
dateModified: 2026-04-19
due: 2026-04-25      # Optional
scheduled: 2026-04-20 # Optional
---

# Task Title

Description and checklists:
- [ ] Item 1
- [x] Item 2 (done)
```

Active tasks are those with `task` tag but NOT `archived` tag, and status ≠ `done`.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview build locally
npm run preview
```

## Deployment

### 1. Set up Cloudflare secrets

```bash
wrangler secret put S3_ACCESS_KEY
# Enter your access key

wrangler secret put S3_SECRET_KEY
# Enter your secret key
```

### 2. Deploy

```bash
npm run build
wrangler deploy
```

Or use the deploy script:

```bash
wrangler deploy dist/server/entry.mjs --config dist/server/wrangler.json
```

## Features Guide

### Pinned Folders

- Click the 📌 icon next to a folder in the sidebar to pin it
- Pinned folders appear on the homepage and section pages
- Click the × on a pinned card to unpin

### Images

Images referenced with relative paths in markdown are automatically proxied:

```markdown
![Alt text](./image.jpg)
![Alt text](../other-folder/image.png)
```

The image URL is rewritten from `./image.jpg` → `/api/img/1.%20Projects/Folder/image.jpg`, keeping your S3 bucket private.

### Search

Press `⌘K` (or `Ctrl+K`) to open the search dialog. Search matches note titles and paths.

### Tasks

- Homepage shows a scrollable list of active tasks
- Click "View all" to see the full task page with sidebar
- Tasks are sorted by urgency (priority + due date proximity)
- Each task links to its detail page with rendered markdown

## Security Notes

- **Never commit `.env` to git** — it's in `.gitignore`
- **S3 credentials are inlined at build time** — they're not exposed to the client
- **Private bucket is recommended** — use the image proxy (`/api/img/*`) instead of public S3 URLs
- **Image proxy validates file extensions** — only images (jpg, png, gif, webp, svg, avif, bmp) are served

## License

MIT

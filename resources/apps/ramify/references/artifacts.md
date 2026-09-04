# Artifact requirements

An artifact node stores its artifact kind in `type` and its relative file path in `content`. A text node instead stores inline body text in `content`.

## Storage

- Files use stable paths: `artifacts/<project-id>/<node-id>.<ext>`.
- HTML, Markdown, SVG, and decoded media are real files.
- Remote media is a `.url` reference file.
- The database stores only the artifact `type` and its relative path in `content`; MIME and state are derived.
- Agents may edit artifact files directly. Ramify watches them and refreshes previews.
- Back up the complete Ramify data directory, not the SQLite file alone.

## HTML

- Produce one complete HTML document.
- JavaScript, external scripts and styles, network requests, forms, workers, nested pages, and other normal browser features are supported in the detail preview and standalone window.
- Canvas thumbnails do not execute JavaScript; animation and interaction begin when the user opens the detail preview.

## Markdown

- Produce complete, usable Markdown rather than an outline.
- Do not leave placeholders.

## SVG

- Produce one `<svg>` with a `viewBox`; inline or external styling and scripts are supported in the detail preview.

## Image, video, and audio

- Generate media through the user's own Agent and provider integration.
- Never send provider API keys to Ramify.
- Attach any source URL supported by the browser or a matching `data:image/*`, `data:video/*`, or `data:audio/*` URI.
- Ramify uses native media controls and never autoplays.
- Remote URLs disclose the user's IP address to the media host when previewed.

Make alternative artifacts materially different in structure, visual language, or tone—not merely different colors.

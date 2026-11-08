# Changelog

## 0.2.0 — 2026-11-08

First version published to the plugin market. Everything below is what changed since the 0.1.0 snapshot.

### Editor
- **Slash menu** (`/`): table with a size picker, image upload (also paste and drop), headings, lists, task list, quote, callout, code block, divider. Rendered in a portal so it does not drift or move the card on a zoomed canvas.
- **Callouts** in Obsidian syntax (`> [!type] Title`, `+` / `-` for fold state, 13 types and their aliases), with an editable title and click-to-fold. Backspace stays inside the callout; a gap cursor lets you add a line before, between, and after callouts; Enter in an empty callout adds a line instead of deleting the callout.
- **`==highlight==`**, with a shortcut (`⌘⇧H`); a literal `==` is escaped on save so it never turns into a highlight.
- **Tables**: cells keep lists and several paragraphs (such a table is stored as single-line HTML); a floating toolbar (insert / delete rows and columns, header row and column, delete table); draggable column widths that follow the canvas zoom (double-click a border to reset). A table is stored as plain Markdown unless it holds something Markdown cannot express (cell lists, custom widths, a header column, or no header row).
- **Images** are stored as `assets/<name>` relative to the board and mapped to a real URL on display.
- **Paragraph-leading markers** such as `1. ` or `# ` typed as plain text are escaped on save, so they are not turned into lists or headings the next time the card is opened.

### Cards
- **Three height states** for text cards: collapsed (fixed preview), default (the height last set by hand), expanded (fits the content, and re-fits when the content changes without adding an undo step). Dragging a card edge sets a new default height and leaves collapsed / expanded. A floating-toolbar switch jumps between the three states. Boards written by 0.1.0 (`collapsed` / `expandedHeight`) open unchanged.
- The side panel remembers, **per board**, whether it was open, which tab, and which card's details were shown. Its width is shared across boards.
- **Chat references**: add the selected elements to the chat input as clickable, removable objects (button or `@` menu); the same element is never added twice.

### Frames
- A frame keeps growing while a card is pushed outward past its edge, with a buffer zone and hysteresis so it does not snap back.

### Copy and paste
- Pasting **Markdown source** is parsed as Markdown (headings, nested lists, callouts, `==highlight==`, tables); ordinary text is left alone.
- Pasting **rich text**: background-coloured spans become highlights, Obsidian reading-mode callouts become callouts, wiki image links that cannot be resolved become placeholder text.
- **Copying** writes Markdown to `text/plain` and a self-styled HTML version to `text/html` (callouts become coloured quotes, tables get borders). Copying and pasting within ThinkBoard restores callouts with their type and title.

### Agent
- `thinkboard_edit`: `arrange` with `collapse` / `expand` follows the three-state model (`expand` returns a card to its default height); node `fold` (`collapsed` | `expanded`) and `baseHeight` are validated. `thinkboard_read` reports `fold` and `baseHeight`. The tool text documents that tables with block content are stored as single-line `<table>` HTML.

### Known limitations
- Pasting into a corporate wiki flattens multi-level lists; pasting from Feishu/Lark may lose blank lines between paragraphs; table header styling is not kept when pasting between a corporate wiki, Feishu/Lark, and ThinkBoard.

### Internal
- Browser tests: isolated browser profile and debugging port per run, `--only=` section filter, hang diagnostics (main-thread call stack and process state on timeout), and the machine is kept awake while they run, because a sleeping machine suspends the headless browser. The suite has 781 canvas checks, 80 shell checks, and 10 sandbox checks, plus 395 unit tests.

## 0.1.0 — 2026-11-04

First public test release.

- **Boards**: create, rename, duplicate, trash. A board is a folder (`board.json` + `assets/`) in a library directory; plain JSON, stable ordering, one element per line, so it syncs cleanly through iCloud, Dropbox, or git.
- **Cards**: Markdown with live WYSIWYG editing (lists with level-aware numbering, tasks, tables, code), image cards, sandboxed HTML cards. Long text can be collapsed and edited in a details panel.
- **Shapes and flowcharts**: 15 shapes, free text, curved / elbow / straight connectors with arrow or dot ends, draggable elbow segments, one-click "+" to extend a flowchart.
- **Frames and groups**: titled frames that contain cards by position; groups (nestable) that select, move, scale, and copy as one.
- **Layout**: alignment guides and equal-spacing hints while dragging, align / distribute, copy / paste, undo / redo, search, optional minimap, PNG export.
- **Agent**: the built-in chat is embedded beside the canvas; `thinkboard_read` and `thinkboard_edit` let the agent read and edit the same board atomically.

# Changelog

## 0.1.0 — 2026-11-04

First public test release.

- **Boards**: create, rename, duplicate, trash. A board is a folder (`board.json` + `assets/`) in a library directory; plain JSON, stable ordering, one element per line, so it syncs cleanly through iCloud, Dropbox, or git.
- **Cards**: Markdown with live WYSIWYG editing (lists with level-aware numbering, tasks, tables, code), image cards, sandboxed HTML cards. Long text can be collapsed and edited in a details panel.
- **Shapes and flowcharts**: 15 shapes, free text, curved / elbow / straight connectors with arrow or dot ends, draggable elbow segments, one-click "+" to extend a flowchart.
- **Frames and groups**: titled frames that contain cards by position; groups (nestable) that select, move, scale, and copy as one.
- **Layout**: alignment guides and equal-spacing hints while dragging, align / distribute, copy / paste, undo / redo, search, optional minimap, PNG export.
- **Agent**: the built-in chat is embedded beside the canvas; `thinkboard_read` and `thinkboard_edit` let the agent read and edit the same board atomically.

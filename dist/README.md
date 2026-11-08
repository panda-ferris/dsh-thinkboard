# ThinkBoard

An infinite canvas for DeepSeek Harness (dsh): Markdown and image cards, frames, flowchart shapes, and labeled connections — with the built-in chat agent sitting next to it and able to read and edit the same board.

> **Status: test release (0.2.x).** It is used daily by its author, but the data format and some behaviors may still change. Boards are plain JSON files, so nothing is locked in.

[中文说明](#中文说明)

## What it does

- **Boards are folders**: `board.json` + `assets/` inside a library directory. Plain JSON, stable ordering, one element per line — it syncs cleanly through iCloud, Dropbox, or git, and diffs are readable.
- **Cards**: Markdown with WYSIWYG editing (headings, lists with level-aware numbering `1.` → `a.` → `i.`, tasks, tables, code, callouts, `==highlight==`, images), image cards, and sandboxed HTML cards. Text cards have three height states — **collapsed** (a short fixed preview), **default** (the height you last set by hand), and **expanded** (fits the content) — switched from the floating toolbar. Long text can be edited in a side details panel; the side panel remembers, per board, whether it was open and which card's details you were viewing.
- **Editor**: type `/` for a menu (table with a size picker, image upload, headings, lists, quote, callout, code, divider). Callouts use Obsidian syntax (`> [!note] Title`, with `+` / `-` for fold state). Tables have a floating toolbar (insert / delete rows and columns, header row / column, delete table) and draggable column widths.
- **Copy and paste**: pasting Markdown source (for example from Obsidian) is parsed as Markdown; pasting rich text from the web, Feishu/Lark, Word, or a corporate wiki keeps headings, lists, tables, and highlights. Copying puts Markdown in `text/plain` and a self-styled HTML version in `text/html`, so callouts and tables survive in other tools.
- **Shapes and flowcharts**: 15 shapes, free text, curved / elbow / straight connectors, arrow or dot ends, draggable elbow segments, and a "+" on each side to extend a flowchart in one click.
- **Frames and groups**: titled frames that contain cards by position; groups (nestable) that select, move, scale, and copy as one.
- **Layout**: alignment guides and equal-spacing hints while dragging (hold Alt to turn snapping off), align / distribute, copy / paste, undo / redo, search, an optional minimap, PNG export.
- **Agent**: each board can be bound to a dsh session, shown beside the canvas. The agent uses two tools — `thinkboard_read` and `thinkboard_edit` — which go through the same validated operations as the UI, so a failed batch changes nothing.

## Install

ThinkBoard is distributed through a dsh **plugin market index**.

1. In dsh open **Plugins → Discover → Add index source** and paste:

   ```
   https://panda-ferris.github.io/dsh-thinkboard/index.json
   ```

2. Find **ThinkBoard** and install it. It needs dsh `>=0.2.1-rc.1 <0.2.2-0`; the market shows compatibility.

No build step and no install scripts: the repository ships the built package under `dist/`.

Alternatively, install straight from Git with the plugin manager, using the spec `git+https://github.com/panda-ferris/dsh-thinkboard.git#<commit>&path:/dist`.

## Where your boards live

`~/Documents/DSH Whiteboards` by default. Deleting a board moves it to `.trash/` inside that folder. To use another folder, set `libraryDir` in the plugin's config row of your profile.

Boards created by earlier builds (when the plugin was called `dsh-whiteboard`) are in the same folder and open unchanged.

## Using it

| Do this | To get this |
|---|---|
| Double-click empty canvas | New card |
| Left toolbar → shapes, or `R` / `O` / `T` / `N` | Place a shape / ellipse / text / card (click or drag a size; `Esc` exits) |
| Drag from a dot on a card edge | Connect cards; drop on empty canvas to create a linked card |
| Select a connector, drag its ends | Reconnect to another card or shape |
| Select an elbow connector, drag the middle bar | Route it around other shapes |
| `⌘G` / `⌘⇧G` | Group / ungroup (double-click a member to enter a group, `Esc` to leave) |
| Drag cards onto a frame | Add them to it (the frame highlights) |
| `Tab` / `Shift+Tab` in a list | Indent / outdent, keeping sub-levels' relative structure |
| Double-click the board title | Rename |
| Select a text card → height switch (collapsed / default / expanded) | Fold a long card, restore it, or fit it to its content; dragging a card edge sets a new default height |
| `/` in a card | Insert a table, image, heading, list, callout, … |
| Click inside a table | Floating toolbar for rows, columns, and headers; drag a column border to resize it (double-click to reset) |

## Safety notes

- The plugin's HTTP routes (`/api/thinkboard/*`) are checked against dsh's own login before doing anything; unauthenticated requests get 401/403.
- HTML cards run in a sandboxed iframe (`sandbox=""`, no scripts, no network, no same-origin access) after sanitizing, limited to 200 KB.
- Image uploads are limited to 20 MB; asset paths are restricted to the board's own `assets/` folder.

## Known limitations

- Single-user: there is no real-time collaboration. Sharing a library folder through a file-sync service works, but concurrent edits of the *same board* from two machines are not merged.
- Elbow connectors avoid nothing automatically — use the middle handle to route around shapes.
- Pasted raw HTML inside Markdown is dropped (Markdown round-trips are lossless for the supported syntax; tables may change whitespace).
- A table is stored as GitHub-flavoured Markdown when that can represent it. Tables with lists or several paragraphs in a cell, custom column widths, a header column, or no header row are stored as single-line `<table>` HTML instead — Markdown has no way to hold them.
- Pasting into a corporate wiki: multi-level lists lose their nesting (each item becomes a paragraph), and table header styling is not kept. Pasting from Feishu/Lark may lose the blank lines between paragraphs. Highlight colours may map to the nearest supported colour.
- The plugin's own browser tests need Google Chrome and keep the machine awake while they run (`caffeinate` on macOS); a sleeping machine suspends the headless browser and the tests time out.
- Large boards (hundreds of cards with long Markdown) have not been stress-tested yet.

## Development

```
npm install --allow-remote=all   # only if your npm blocks remote tarballs
npm test                         # unit tests
npm run build                    # builds dist/ (the installable package)
npm run verify                   # checks dist/ as a stranger's machine would see it
npm run e2e                      # browser tests (needs Google Chrome)
node e2e/run.mjs --only=表格   # run only the later sections whose (Chinese) title contains the keyword, e.g. 表格 / 高亮块 / 复制粘贴 / slash
```

`dist/` is committed on purpose: the market installs a pinned Git commit, so users never need a build toolchain.

## License

MIT © panda-ferris. Bundled third-party packages (all MIT) are listed in `THIRD_PARTY_NOTICES.md`.

---

## 中文说明

dsh(DeepSeek Harness)的无限画布插件:Markdown / 图片卡片、框、流程图图形、带文字的连线,右侧内置对话里的 agent 可以读写同一块白板。

**安装**:在 dsh 里打开「插件 → 发现 → 添加索引源」,填入

```
https://panda-ferris.github.io/dsh-thinkboard/index.json
```

然后安装 **ThinkBoard**。无需构建,无需允许安装脚本。

**数据**:白板是库目录里的一个文件夹(`board.json` + `assets/`),默认 `~/Documents/DSH Whiteboards`,纯文本 JSON,可放进 iCloud / Dropbox / git。删除的白板进入该目录下的 `.trash/`。旧版(名为 dsh-whiteboard)创建的白板原样可用。

**编辑器**:卡片里输入 `/` 呼出菜单(表格、图片、标题、列表、引用、高亮块、代码、分割线);高亮块用 Obsidian 语法(`> [!note] 标题`);表格有浮动工具条并可拖动列宽。文字卡片有折叠 / 默认 / 展开三种高度状态;右侧栏按白板记住是否展开和详情里正在看的卡片。粘贴 Markdown 源码会按 Markdown 解析;复制出去时纯文本是 Markdown、HTML 带内联样式。

**已知限制**:单人使用,没有实时协同;折线连线不会自动避开图形,需要拖中间的手柄;超大白板尚未做压力测试;粘贴到某些内部 wiki 时多级列表会变成平铺段落;从飞书粘贴可能丢失段落间空行。

问题反馈请提 [Issue](https://github.com/panda-ferris/dsh-thinkboard/issues)。

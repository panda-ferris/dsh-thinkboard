# ThinkBoard

An infinite canvas for DeepSeek Harness (dsh): Markdown and image cards, frames, flowchart shapes, and labeled connections — with the built-in chat agent sitting next to it and able to read and edit the same board.

> **Status: test release (0.1.x).** It is used daily by its author, but the data format and some behaviors may still change. Boards are plain JSON files, so nothing is locked in.

[中文说明](#中文说明)

## What it does

- **Boards are folders**: `board.json` + `assets/` inside a library directory. Plain JSON, stable ordering, one element per line — it syncs cleanly through iCloud, Dropbox, or git, and diffs are readable.
- **Cards**: Markdown with WYSIWYG editing (headings, lists with level-aware numbering `1.` → `a.` → `i.`, tasks, tables, code), image cards, and sandboxed HTML cards. Long text can be collapsed and edited in a side details panel.
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

## Safety notes

- The plugin's HTTP routes (`/api/thinkboard/*`) are checked against dsh's own login before doing anything; unauthenticated requests get 401/403.
- HTML cards run in a sandboxed iframe (`sandbox=""`, no scripts, no network, no same-origin access) after sanitizing, limited to 200 KB.
- Image uploads are limited to 20 MB; asset paths are restricted to the board's own `assets/` folder.

## Known limitations

- Single-user: there is no real-time collaboration. Sharing a library folder through a file-sync service works, but concurrent edits of the *same board* from two machines are not merged.
- Elbow connectors avoid nothing automatically — use the middle handle to route around shapes.
- Pasted raw HTML inside Markdown is dropped (Markdown round-trips are lossless for the supported syntax; tables may change whitespace).
- Large boards (hundreds of cards with long Markdown) have not been stress-tested yet.

## Development

```
npm install --allow-remote=all   # only if your npm blocks remote tarballs
npm test                         # unit tests
npm run build                    # builds dist/ (the installable package)
npm run verify                   # checks dist/ as a stranger's machine would see it
npm run e2e                      # browser tests (needs Google Chrome)
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

**已知限制**:单人使用,没有实时协同;折线连线不会自动避开图形,需要拖中间的手柄;超大白板尚未做压力测试。

问题反馈请提 [Issue](https://github.com/panda-ferris/dsh-thinkboard/issues)。

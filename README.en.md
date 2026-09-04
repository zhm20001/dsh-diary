# dsh-diary · Diary Plugin

A diary plugin for dsh (DeepSeek Harness): write your diary on a paper-letter-styled web page where **the raw text is saved to disk first and the AI comment is generated after** — a failed summary never loses your writing.

中文版 · Built-in guide: press `?` at the top right of the page (or open `/diary/guide`) after installing.

## Preview

| Daily writing (light) | Dark |
|:---:|:---:|
| ![Main UI · light](assets/preview-light.png) | ![Main UI · dark](assets/preview-dark.png) |

| First-run setup card | Built-in guide (zh/EN) |
|:---:|:---:|
| ![First-run setup](assets/preview-setup.png) | ![Guide](assets/preview-guide.png) |

## Division of labor

| Who | Owns |
|---|---|
| Plugin code (deterministic) | 30-hour-clock date resolution (system time), template-based file creation, entry appending, comment-block layout, trailing timestamp, stripping the old comment block on resubmit |
| LLM (called directly via `ctx.llm`) | Produces exactly four things: a keyword, a one-line summary, an emoji of the day, and a comment. provider/model/temperature default to plugin config; the page's "comment model" selector can override provider/model per submit (only combinations present in the model catalog are honored) |

## Quick start

```bash
git clone https://github.com/zhm20001/dsh-diary.git
cd dsh-diary
pnpm install            # compiled lib/ is committed — no build needed
dsh plugin --profile web add <path-to-this-repo>
# restart dsh web, then open http://127.0.0.1:<port>/diary
```

On first open the page shows a **setup card**: enter a diary directory (e.g. `~/Documents/Diary`; `~` expands to your home) and save — it is written to the plugin's `config.json` and takes effect immediately, no restart. Then write your first entry → "Save & summarize".

Daily flow: open the page → write → submit. The raw text hits disk immediately; if the summary fails, your text is safe — press "Retry summary only". Drafts autosave to browser localStorage (keyed per date). The dsh web sidebar also gets a "Diary" entry at its footer (`src/client.js`, label follows your browser language).

## Configuration

Three layers, highest priority first:

| Layer | Notes |
|---|---|
| cordis patch / profile config | Injected at load time; when `diaryDir` is set here the setup card warns "overridden" |
| `config.json` in the plugin root | What the setup card maintains; hand-editable too. `diaryDir` is re-read on every request — edits apply immediately. See [`config.example.json`](./config.example.json); relative paths resolve against the plugin root, `~/` supported |
| Built-in defaults | Template falls back to `assets/diary-template.md`; with no directory configured the page enters setup mode |

Other plugin options (cordis patch layer): `provider` / `model` (summary model, defaults `deepseek-official` / `deepseek-chat`), `temperature` (0.6), `timeoutMs` (120000), `nightCutoff` (6), `pagePath` (`/diary`; if changed, update the href in `src/client.js` too).

## Privacy & your data

- Your full diary text is stored only on your machine. The **single outbound call** is summary generation: the day's full text goes to the configured (or selected) LLM provider and comes back as the four fields. Heatmap data, meta files and drafts never leave your machine (drafts live in browser localStorage).
- Data is self-contained in the diary directory: entries are `YYYY-MM-DD.md`; the day's emoji lives in the hidden `.diary-meta/YYYY.json` inside the same directory. **Backup = copy the whole directory** (don't forget `.diary-meta/` when migrating, or emoji silently degrade to plain green cells).
- "Has a diary" is always derived from filenames in the directory at request time (suffixed files like `2026-04-28-note.md` count as 04-28; multiple files per day are not double-counted) — manual create/delete/rename shows up on the heatmap immediately; orphaned emoji in meta are ignored harmlessly.

## Semantics

- **30-hour clock**: anything written between midnight and `nightCutoff` (default 6 am) counts as the previous day, with timestamps shown as 25:xx–29:xx — late-night entries never split across two files.
- **Resubmitting the same day** appends the new text and regenerates the summary for the whole day: the old AI comment block is stripped and rewritten; everything you wrote above it is untouched. Convention: don't hand-edit below the `## AI评注` heading.
- **File contract**: `<diaryDir>/YYYY-MM-DD.md`, front matter from the template (empty `date:` field or `{{date}}` placeholder supported).
- On summary failure the API returns `stage:'summary'` + hint (HTTP 502); a save failure returns `stage:'save'`.
- **Heatmap**: one frame per half-year, a fixed 27-week × 7-day grid starting Monday; frames start on the Monday of/before the half-year's first day, and adjacent frames intentionally share an edge week. Written = the day's emoji (green cell when no emoji); past unwritten = faded; future = grey; today gets a ring. The denominator is the actual number of days in that half-year. In rare years (July 1 falling on a Sunday, e.g. 2018/2029) the H2 window spans 190 days — the Dec-31 cell is not drawn (counts unaffected).
- Backfilling comments for old entries / moving directories / deleting a day: see the "Your data" section of the built-in guide.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test               # vitest: core pure functions + path resolution + atomic writes
pnpm build              # regenerates lib/ (CI verifies it matches src/)

# Smoke: a dev overlay points the plugin at /tmp/diary-sandbox — never touches your real diary
dsh web --patch dev.patch.yml   # then browse /diary-dev
```

Structure: `src/core.ts` pure functions (no IO) → `src/paths.ts` path vars (config.json read/write) → `src/service.ts` routing & orchestration (webServer/httpServer dual-name compatible) → `src/summary.ts` LLM pipeline → `src/page.ts` page + `src/guide.ts` guide. `lib/` is compiled output, committed with the repo (clone-and-use, no build); changes to `src/` must be committed together with `lib/`.

Host requirement: a dsh web host (the internal harness build exposes `ctx.webServer`, the npm `@deepseek-ai/dsh-host-webserver` rc line exposes `ctx.httpServer` — both are supported).

## License

[MIT](./LICENSE)

# 🦥 게으름뱅이 시스템 · Memory Books fork development

Project: [AmbasaS2/SillyTavern-MemoryBooks](https://github.com/AmbasaS2/SillyTavern-MemoryBooks), forked from [aikohanasaki/SillyTavern-MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks) v9.4.0 / `5a79f667` (AGPL-3.0).

## Current main status — 2026-11-27 (KST)

Published version: `9.4.0-ambasa.5`, display name **Memory Books (Sloth)**. Runtime baseline is [PR #19 / 204d0db](https://github.com/AmbasaS2/SillyTavern-MemoryBooks/commit/204d0dbe762aaafef62dcd92d7a1b9965568c566), merged in [026698a](https://github.com/AmbasaS2/SillyTavern-MemoryBooks/commit/026698a473c43e00e6a858e09f3d909294d43937); merge tree matches the tested candidate. The version/documentation commit does not change runtime JS/CSS. Install/update the existing fork from [AmbasaS2/SillyTavern-MemoryBooks](https://github.com/AmbasaS2/SillyTavern-MemoryBooks); do not install a second Memory Books alongside it.

- Sloth is for individual character chats; Original mode remains available and group chats use Original mode. Nexus/Memory are roles, not required filename prefixes.
- Single collection request per source chunk; optional review can add one request and Side Prompts are separate. Manual Hide is opt-in, automatic collection does not Hide. Recent three completed Scenes remain always on; earlier Scenes retain their full text in configured vector/keyword recall.
- Memory overview is read-only. Memory Workshop analyzes on request, displays suggested changes, and writes only explicitly selected and approved changes; Core-to-Anchor moves require acknowledgment of recall impact. Existing LT titles and internal role `lt` remain compatible with the public Anchor name.
- Preserve existing protected entries, original content, UIDs, recall settings, and recovery contracts. Targeted evidence guards and recoverable partial writes remain; two-book saves use compensating rollback rather than an atomic server transaction. Do not discard whole memories merely because a model's interpretation is imperfect.
- Verification: [657/657 Node tests and Bun build](https://github.com/AmbasaS2/SillyTavern-MemoryBooks/actions/runs/45967046865), isolated ST 1.19.1 Chrome host checks (Korean/English, 390/1280px, light/dark), legacy/new Anchor compatibility, actual storage readback and rollback. No new model calls in the final host test.
- Known limits: a valid closing quote does not establish semantic accuracy; omissions, attribution mistakes and incorrect emotional interpretations can still be saved. User's release gate is functional/data safety, not perfect model interpretation. Some host/role labels remain English in Korean UI. Actual RP retrieval and installed devices are not covered by the final isolated host verification.
- #20 remains a separate unadopted writing experiment; do not include it in this version or require repeated model runs. Pre-release rollback reference: `83223a6f700a12b2212f1d049056d2430793d7b7`. Back up existing user data before updating or downgrading; resolve pending recovery first, as older code may not understand newer recovery contracts.

### Taking over a manually maintained story

1. Numbered, active entries with a completed Scene and Result participate in recent-three rotation when a new Scene is saved. Existing content, source metadata, archived entries, Outlets, and disabled entries are preserved. Keyword rotation still requires older Scenes to have recall keywords.
2. In **Manage existing memories → Review previously summarized messages**, enter the exact ranges that are already covered. Check the displayed endpoints before saving. The record is scoped to this chat and Nexus/Memory pair. A source edit inside a reviewed span requires reviewing or clearing the span again. Legacy numeric hints alone do not skip any messages.
3. Reuse the existing active Long-Term Memory, Scene Continuity, Status, LT, and NPC UIDs. Preserve their activation settings. Compare aliases and topic context before creating an entry. An explicit NPC alias or a qualified form of an existing name can block a duplicate without merging two existing entries.
4. A native chat rename carries the same per-chat role assignment forward. A native World Info rename can retarget Sloth role names and Side Prompt story links when the editor supplies a unique, exact copy followed by the removal of the old filename. An ambiguous copy cannot be used to infer a rename.
5. Model classification and proposed edits still require empirical comparison. A structurally valid Scene can be saved while an invalid Nexus change is skipped.

Historical development log follows. Do not treat its old draft-only, no-main, or not-implemented statements as present instructions.

---

## Historical development log — 2026-11-23 onward

The following text describes earlier development snapshots and is preserved for provenance.

### Previous main snapshot — 2026-11-27 (historical)

Reviewed source baseline: [main `0883ddc`](https://github.com/AmbasaS2/SillyTavern-MemoryBooks/commit/0883ddc24b3e689fe997a674ab98f63e938a3a63), manifest `9.4.0-ambasa.3`, display name **Sloth's Memory Books**. See [current bilingual guide](./readme.md). That snapshot already includes the Sloth workflow and compiled JS/CSS. The November 23 development-branch sections below are retained as historical records; their old branch names, release restrictions, tests, and incomplete-feature lists are **not** the current project state.

- **Purpose:** replace recurring manual chat/JSON memory updates inside SillyTavern, while keeping Original mode available. Sloth is for individual character chats; group chats use Original mode. Nexus and Memory are roles, not mandatory filename prefixes.
- **Current workflow:** one collection request per source chunk without range/plan approval. Optional review adds up to one request; optional Side Prompts remain separate. Manual Hide is opt-in; automatic collection does not Hide. See SLOTH_SINGLE_COLLECTION_EXPERIMENT.md.
- **Nexus:** reuse recognized existing combined Long-Term Memory/continuity and LT/NPC entries where possible; first setup may create separate Core Memory and Current Continuity entries. Preserve protected/disabled entries and special Outlets. Normal Nexus updates no longer require literal chat quotation receipts; structural checks and optimistic write/read-back remain. Two-book saves use compensating rollback, not an atomic server transaction.
- **Memory:** new collection uses causal event boundaries, Timeline / Scene / Result, source ranges and recent-three rotation. Older recall is vector or keyword by configuration. Jev retrieval belongs to the optional STLO fork, not this extension.
- **Verification history:** the November 26 side-prompt commit [`b010ca3`](https://github.com/AmbasaS2/SillyTavern-MemoryBooks/commit/b010ca3bc4fb87410f3cb6254fcf51c2d42a225b) was recorded as passing 543 Node tests and a Bun build. Earlier isolated browser tests and real-model trials are historical evidence, not a fresh test of this HEAD. Live installed-device behavior and semantic model accuracy are not guaranteed.

- **2026-11-27 recall UI:** injection settings default to collapsed; Nexus and Memory columns wrap according to panel width. Icon pickers choose each type independently. NPC collection remains enabled (legacy off falls back to the configured detail mode). Node tests 548/548 and Bun build passed; actual ST rendering and real-model comparison remain pending.

## Naming

- Full: **🦥 게으름뱅이 시스템**
- Short: **🦥 게으름뱅이**
- Icon-only in narrow UI: **🦥**
- World Info roles: **Nexus** (Core Memory, Current Continuity, LT, NPC and existing non-Scene entries) and **Memory** (complete Scene entries). These are roles, **not required filename prefixes**.

## Implemented in this development branch

### Role configuration and new-chat continuity

- The main popup has a scoped Sloth connection card with a clear Korean explanation and two role selectors.
- Detects **SillyTavern character-linked** World Info books: the primary `character.data.extensions.world` plus additional `world_info.charLore[].extraBooks`, matched by the character's avatar filename. It does **not** treat chat-only lorebook binding as a character book.
- Stores the user's role choice keyed by character avatar in extension settings `nexusCharacterRoles`, so the same roles resolve in a new chat without copying old chat processing markers or hiding new chat messages.
- Both Nexus and Memory roles must be configured with **different**, currently linked and existing books before Sloth collection starts. Missing/detached books fail closed, and unrelated characters never inherit these roles.
- Character avatar rename/deletion updates or removes the corresponding role settings. Existing single-book character locks, old chats and group behavior are not migrated or rewritten.
- The assigned **Memory** target overrides stale chat-bound and manual lorebook selection for memory collection. Assigned **Nexus** is the default target for non-Scene Side Prompt updates, while explicit custom Side Prompt targets remain supported if not the assigned Memory Scene book.
- Automatic summaries, reminders and auto-hide are suppressed when Sloth roles are active. Memory saves still require explicit preview approval.

### Per-chat AU lorebook overrides (2026-11-23 development slice)

- In an individual character chat with a stable chat filename, turn on **Use different lorebooks for this chat only** to override the character's default Nexus/Memory pair. The existing selectors then edit only that chat's pair; turn it off to restore the character defaults.
- The opt-in pair is stored in the nexusChatRoleOverrides extension setting under character:<avatar>:<chat-file>, not copied per-chat metadata. New and branched chats start with the character defaults rather than accidentally inheriting an AU. A queued job resolves the original chat key, even if another chat becomes active.
- Only existing character-linked books are eligible. A missing, detached or corrupt mapping blocks writes; different Nexus and Memory books remain mandatory. Group chats still use legacy behavior.
- Changing the pair is blocked after the chat has a Sloth collection receipt or legacy processed checkpoint; previously collected Scenes require a separate reviewed migration. New collection receipts also bind the saved pair, preventing external changes to the settings from silently redirecting later collections.
- Avatar file renames migrate the chat-key registry without replacing a conflicting record; deleting a character clears its old chat overrides.
- Added pure and routing regression tests, source/UI wiring checks, and translations for the new controls in non-English locales. Original user lorebooks, installed ST, main, and extension manifest are untouched. **Not live-tested**.

### Reviewed legacy Nexus migration (2026-11-23 development slice)

- Added an explicit **🦥 Review legacy Nexus migration** button in the same character role screen. This is **not** an automatic conversion and **not** an installed release.
- Examines the selected **Nexus** World Info for legacy Long-Term Memory (…), Scene Continuity (…) and Status entries, including the title shape present in the user-provided Remus/Catherine Core JSON. Refuses duplicate UIDs, duplicate source types, conflicting new titles, disabled originals, special Outlets and ambiguous structures; does not read source contents through an AI.
- Before any write, clones the full Nexus JSON and constructs a lossless proposal: Long-Term Memory text is copied verbatim into a new, always-on Core Memory entry, with its original insertion position/order; old Scene Continuity and Status texts are copied verbatim into source-labelled sections of a new, always-on Current Continuity. No unconfirmed lore, attribution, dates or current status is inferred. When there is no old status content, the migration does not invent a Current Continuity entry.
- Every original entry (including content, UID, STMB history, STLO/custom metadata, NPC/LT, Kinks, PanelAssets, and other Outlets) stays in the same Nexus file. Migrated original entries are marked as **disabled archives**, never deleted, to prevent double injection. A migration receipt on each new entry ties its source UIDs to the archived records; missing/invalid links fail closed. Old Side Prompt upserts in the Memory Books extension are blocked from recreating or overwriting archived legacy types. Existing Side Prompt templates themselves remain untouched and require separate reviewed redesign; not silently retargeted.
- Preview displays exact original and proposed new text. The user must explicitly approve after triggering a download of the full original JSON backup. Before writing, the server copy is freshly reloaded to reject stale edits; write is followed by server read-back. On a failed/uncertain write, an optimistic rollback restores the original only if the server still holds the staged version, otherwise warns that manual recovery from backup may be required.
- This slice is intentionally **Nexus-only**. The Memory World Info is read for safety but not written. **Old combined one-book Memory + Side Prompt + special Outlet layouts still require a separately designed, two-book UID/reference-preserving split**; they are detected and blocked. Neither already-existing split/merged Scene repair nor final semantic conversion of the verbatim Current Continuity sections is claimed as finished.
- Isolation tests cover known legacy title format, history preservation, source copy integrity, Outlet/UID conflicts, idempotency, blocked Side Prompt writes, optimistic save/read-back/recovery, UI wiring and localization. Actual running SillyTavern, STLO, lore-manager, browser popup and real content-quality tests remain unfinished.

### Reviewed mixed one-book Memory → Nexus / Memory split (2026-11-23 development slice)

- Implemented a second path behind the same explicit legacy-migration command. It detects an older combined Memory World Info containing both completed, numbered Scenes and non-Scene records (Long-Term Memory, Scene Continuity, Status, NPC Index, Kinks/PanelAssets and other existing entries). This path is separate from the earlier Nexus-only migration.
- Pure-policy preflight rejects duplicate entry UIDs, duplicate destination titles, existing conflicting new Core/Current entries, incomplete/un-numbered Scene structures, source metadata with unresolved cross-entry references, unsafe STLO root configuration and keyword-only recall without keys. **No file is changed when an unsupported structure is detected.**
- On isolated cloned books, copy each non-Scene source record into Nexus with its complete original entry snapshot (including the prior UID and all STMB history/custom metadata). Assign a new Nexus UID and preserve an explicit source→target UID map. Run the previous lossless Core/Current migration on the copied legacy source entries, leaving those old source records as disabled archives. Kinks, PanelAssets, NPC Index and other eligible non-Scene records keep their original conditions and Outlets. The original Memory book becomes Scene-only; the original Scene content, UID, source ranges and message history remain byte-identical, while recent-three activation/older recall flags are re-evaluated.
- The approval popup explicitly describes that the non-Scene records will be **removed from the old Memory file after being preserved in Nexus**, lists each moved original UID and new UID, previews new Core/Continuity bodies, reports Scene count/rotation changes, and triggers a full JSON backup of **both original books** before approval.
- Both books are freshly reloaded before write, then written/read back using the existing guarded two-book commit with best-effort compensating rollback. The server does not support a genuinely atomic two-book transaction; partial failures can require manual restore from the backup. No Hide, chat deletion or per-chat collection checkpoint changes.
- A structure-only sanitized fixture derived from the real previously supplied Remus/Lyra 24-entry example (20 Scenes + four Side Prompts, **no narrative content transferred**) exercised the code successfully: 20 Scenes remained, four non-Scenes moved, Core/Current created, recent three Scenes activated. This is a **schema-shape test**, not proof of correct interpretation of the actual roleplay or a tested installed extension.
- Still blocked or pending: original Memory books with complex STLO/canonical links, ambiguous or conflicting entries, AU-specific cross-book content deduplication, lossless reconstruction of advanced historical Side Prompt regeneration behavior after cross-book UID remapping, live STLO/lore-manager interoperability, actual PC/mobile runs, AI causal-quality testing and release review.

### Scene rotation (first integration)

- Keeps the latest three numbered, **completed** Scene entries constant/always-on. Older complete Scenes become vector-recalled, or keyword-recalled when existing keywords are present.
- Stages the change against a clone before the original World Info save. Failing validation/save does not modify the user's source book in memory.
- Rejects mixed/unnumbered/incomplete Scene structures and duplicates; preserves each entry's content, custom Outlets, STMB/STLO metadata, position and order.
- Legacy opt-in rotation for dedicated books named `Memory` or `Memory-...` remains for users who have not assigned character roles.

### UI and localization

- Sloth's new role settings use small, responsive **clean UI** cards scoped to `.stmb-popup`, ST theme colors and inherited font, with a single-column mobile layout. Existing Memory Books screens are still largely upstream and **not yet fully redesigned**.
- Labels follow the 🦥 naming convention; short mode and 3-Scene setting use 🦥 게으름뱅이.
- Translated new controls/explanations in Korean and supported non-English locale JSON; en*.json untouched per upstream AGENTS.md.

## Manual AI collector — development implementation (2026-11-23)

- In the main Memory Books popup, **🦥 Collect completed events** appears when this character has valid Nexus and Memory role assignments. It runs **only after a user click**. No background or automatic token-count trigger.
- nexusCollectorRuntime.js reads original, currently visible chat messages and determines the uncollected set from per-chat ledger, legacy checkpoint and already saved Memory source IDs; originating avatar, linked roles and source message fingerprint are checked after asynchronous AI operations and before writes.
- nexusCollectionAI.js reuses the existing Memory Books completion profile and ST provider, dividing large sources into evidence-only windows before the AI causal event plan. nexusCollectionPolicy.js checks **complete coverage**: each original source message belongs once to a completed event or a deferred unfinished incident. Noncontiguous causal source segments stay distinct from intervening independent events.
- First review offers editable Scene titles and exact source ranges, then validates the changed plan. After approval, Scene bodies are composed in Timeline → Scene → Result format. Existing Nexus is compared for exact-span changes, append-only additions or newly grounded entries. Kinks, PanelAssets, disabled items, custom Outlets and unrelated World Info are protected.
- Optional third AI omission audit is OFF by default. Enabling it uses an extra request and blocks storage on reported omissions or misattributions. Actual model calls and token cost may exceed the two logical phases.
- nexusCollectionPolicy.js stages isolated clones of both World Info JSONs, adds only completed Scenes, retains exact source segments without inventing one continuous STMB_start/end for discontiguous events, and rotates the latest three completed Scene entries.
- Second review displays the full Scene body and the before/after text of every Nexus edit. A combined JSON pre-commit backup download must be triggered as part of explicit final save approval. No automatic Hide. When all source is complete, only a candidate manual Hide endpoint is shown.
- nexusCollectionCommit.js acquires existing STMB lorebook write lanes, rereads both books from the SillyTavern server (optimistic conflict check), saves and rereads each, attempts reverse-order compensation on failure, repairs client cache where needed. **This is best-effort compensating rollback, NOT an atomic two-book server transaction**. Partial recovery is reported as unsafe rather than claiming success. Per-chat collected ledger changes only after verified success for both books.
- This is developer code, **not tested inside running SillyTavern**. AI model quality, actual browser popup flow, legacy data and STLO/lore-manager coexistence require live integration QA before any release.
- New modules: nexusCollectionPolicy.js, nexusCollectionAI.js, nexusCollectionCommit.js, nexusCollectorRuntime.js and their test files. Existing index.js, templates.js, style.css, localization, bundle and CSS build updated. No edits to manifest.json, main or installed user lorebooks.
- Baseline rollback point: feature branch commit 7e6b0ecd (before this collector slice).

## Still missing / blocked / unverified

- Two separately reviewed legacy migration paths now exist in developer code: Nexus-only and selected simple **mixed Memory→Nexus/Memory split**. Complex STLO and cross-entry references remain blocked. Actual SillyTavern verification and semantic subsection-aware Current Continuity conversion remain pending; collector still blocks unreviewed legacy input.
- AI-assisted merge or split of already saved Scene memories, preserving UID/source references.
- AU branch-copy policies for importing existing content between chats are still missing. Per-chat AU role overrides isolate selection, and the reviewed legacy combined-book splitter handles supported simple mixed layouts, but it does not merge histories from different AUs or reconcile advanced cross-book STLO/canonical references.
- Truly atomic two-book writes are not available over two independent SillyTavern World Info endpoints; compensation is best effort, not a database transaction.
- Long-chat provider quality evaluation and token handling, original user PC/mobile SillyTavern UI tests, STLO vector recall and lore-manager synchronization, whole-extension clean digital UI redesign.
- User-approved install/release and version/manifest adjustment or main merge.


## Testing and release safety

Run `node --check` on changed JS, `node --test` and `bun run build.ts`; commit both `index.build.js` + map and `style.build.css` after rebuilding. Node test failures present in unchanged upstream `stmbJobsProgress.test.js` are tracked separately from regressions in this fork.

No manifest/version bump, main merge, live lorebook write or new ZIP release before actual SillyTavern tests. For design decisions, source revision and work log see [Notion](https://app.notion.com/p/421a96b06fd4816b9778fe6a60046d54).


## 2026-11-23 · Current Continuity section-preserving updates (developer slice)

- Added a pure `nexusContinuitySections.js` policy and tests. Existing canonical Present Handoff / Active Threads / Knowledge Boundaries / Active Conditions headings are treated as immutable section boundaries, so one AI edit cannot delete a neighboring section or rewrite an unrelated preamble.
- Introduced a `continuity / append_section` AI-delta action targeting one named section instead of appending unrelated continuity facts to the document tail. A missing named section is appended with a canonical heading while retaining the original text exactly. Existing `replace_exact` can still patch verified text within one section, but generic Continuity `append`, multi-section rewrites and unstructured legacy replacement are rejected before staging writes.
- For migrated legacy Continuity, the `=== BEGIN/END ORIGINAL ... ===` source blocks must remain byte-for-byte unchanged; appending new named sections is allowed. New AI-generated Current Continuity entries must have at least one named section. This does NOT rewrite the historical archives, infer what happened afterward, or complete the separate semantic-conversion/review feature.
- AI delta instructions now request `append_section` and explicitly preserve old source blocks. Existing source, World Info metadata, user installation and character JSON remain untouched. Existing event planning, Scene rotation and two-book approval/backup/rollback code are not modified.
- Regression checks: targeted section tests plus all Node tests, Bun bundle, JS syntax, 26 locale JSON parsing and whitespace check. Expected pre-existing upstream failures: two `stmbJobsProgress.test.js` tests with `createViewSort is not defined`. **No real SillyTavern, provider, STLO or mobile integration QA**.
- Do not bump manifest/version, merge `main`, install over a user's ST, or claim this slice completes all Current Continuity semantic updates. Rollback commit: `9c00f9c4348df03178d48f166ffda29c0dcaf109` before this slice.

## 2026-11-23 · Two-Scene causal merge staging (developer-only, not UI-wired)

- Added `nexusSceneMerge.js` + tests. An explicitly selected pair of completed, numbered Scenes can be inspected and staged as one causal memory without changing the source World Info object. Causality is NOT inferred by this deterministic code; `sameCausalIncident` must be supplied only after a separate AI proposal and explicit user review.
- Enforces exactly two distinct UIDs, compatible stable source-chat identity (no cross-AU merge), valid non-overlapping provenance segments, no source overlap with independent Scenes, no missing/contradictory legacy ranges and no duplicate/incomplete entries. Root STLO, custom Outlets, groups, unknown canonical/cross-entry structures, disabled sources and previously merged Scenes fail closed. Nonstandard old records need a separate reviewed flow.
- Keeps the later Scene UID as the survivor, with a full exact snapshot of BOTH originals in `STMB_slothSceneMerge.sources`; earlier source UID remains as an unchanged-content, disabled archive with a versioned pointer to the survivor. All original UID, body, metadata, chat/source ranges and independent/intervening Scenes can be recovered. Source ranges remain discontiguous where required; no fictitious continuous `STMB_start/end` is invented. Existing keywords are retained and reviewed additions appended. The original input book is never mutated by staging.
- `planNexusSceneRotation` excludes ONLY well-formed, verifiably disabled merged-source archives from the recent-three calculation and vector/keyword recall; it rejects tampering and orphan history. Independent completed Scenes retain original text and provenance, while their activation flags may still rotate normally. Subsequent ordinary Scene collection can add another numbered Scene without re-enabling the archive.
- This slice is an internal **inspection/staging policy only**. It does not add an AI candidate finder, final human approval UI, World Info save endpoint, backup-download button or live migration operation. Do NOT present it as usable merge UI or a finished merge feature. Connecting this staging policy to the existing backup/review/optimistic-save machinery requires an independently reviewed workflow and actual SillyTavern QA.
- Validation: Node targeted tests and full suite, Bun bundle, source/compiled JS syntax and Git whitespace check. The two pre-existing `stmbJobsProgress.test.js` failures remain separate. Leave manifest/version/main and user's World Info untouched. Roll back this slice to `0f5e30dc39ceaaa3061e47a467dc890ca7d3d49d` if the isolated rotation archive handling regresses.


## 2026-11-23 · Manually reviewed existing Scene merge (development slice, NO release)

- Added 'nexusSceneMergeProposals.js' as a pure, source-book-only AI proposal boundary: enumerate completed Scene records **from the current saved chat/AU only**, reject invalid Memory history or oversized catalogs, verify each proposed pair's exact UID, causal explanation, specific saved-Scene evidence, same source chat, non-overlapping ranges, non-Scene/Outlet/canonical/STLO restrictions, and duplicate candidates. AI model suggestions do not grant permission to write.
- 'nexusCollectionAI.js': explicit button-only candidate analysis of *existing saved Scene bodies* and subsequent combined 'Timeline → Scene → Result' draft. This is **not** a cross-check against the original full chat, nor is AI causal correctness proven by source-shape tests. The model may return no safe candidates or fail closed.
- 'nexusCollectorRuntime.js' + 'index.js': explicit Sloth menu action with (1) causal candidate/evidence selection, (2) editable merged title and prose review, (3) final preview of the two original records and merged Scene, with required **complete original Memory JSON backup download + explicit approval**. No background trigger, automatic Hide, Nexus write, chat collection checkpoint edit, or live user-data mutation during development.
- Reuses the existing tested 'stageNexusSceneMerge' snapshot/archive+rotation planner, 'commitSlothNexusMigration' single-book optimistic write/read-back/conditional rollback (generic operation label, unchanged default legacy behavior), 'withStmbWriteLane', role and original chat checks. The earlier Scene is retained as a disabled full-history archive, later UID contains the merged result, and intervening independent Scenes remain intact. A competing World Info writer causes a fail-closed conflict; uncertain rollback is explicitly reported.
- Added 19 UI translation keys in 11 supported non-English locales, with en*.json, manifest.json, version and main deliberately unchanged. No broader UI redesign.
- Isolated VPS tests: **425 Node tests: 423 PASS, 2 pre-existing upstream FAIL** ('stmbJobsProgress.test.js' / 'createViewSort is not defined'). New candidate, UI wiring/translation, pre-existing archive and single-book commit tests pass; Bun browser bundle + sourcemap, JS syntax and Git diff whitespace check pass.
- Unverified release blockers: real ST chat/AI provider and permission flow, popup rendering/backup browser download, full original-chat comparison for merge quality, STLO/canonical complex references, concurrent Lore Manager editing, desktop/Termux/mobile. Keep PR #1 Draft. Do not change manifest/version, merge main or ship ZIP before field QA.
- Rollback point: db494b57291a0717907e880407608fcdf164fb08 on development branch, before this slice.


## 2026-11-23 · Grounded Nexus continuity updates + deferred-only collection (development slice, NO release)

### Observed defect and cause

- The manual collector sent the *generated completed Scene drafts* and Nexus entries to its AI delta planner, but did not show it the **original uncollected chat or deferred/ongoing incidents**. Current Continuity could therefore miss real continuing injuries, unresolved promises or newly disclosed secrets, and any returned delta was checked for exact text but not for original-chat citations.
- If the event planner returned **zero completed Scenes**, the collector exited immediately and never offered an explicitly reviewed Nexus-only current-state update, even when continuing conditions had source-backed changes.

### Narrow implementation

- Added 'nexusEditEvidence.js': verifies each Nexus delta's message ID, verbatim 8–400-character quote and specific reason against original source messages; Current Continuity 'replace_exact' also requires a stated observed resolution/correction/retraction or confirmed new information. A quote is evidence of what was said, **not proof that the model's inference is correct**. Unsupported/missing evidence fails closed. Does not modify World Info.
- 'nexusCollectionAI.js' now receives *the approved event/deferred classifications and original chat messages* when planning Nexus changes. For longer sources, it separately extracts source-quote-bearing evidence windows with exact-ID verification rather than dropping earlier or ongoing messages. Never invents closure merely because a window or date ended.
- 'nexusCollectorRuntime.js' shows each Nexus change with the reason and source quote(s) in the second approval screen, and includes their review receipts in the original JSON backup. When the event analysis finds no completed Scene, it can propose, preview, back up and explicitly approve an **isolated Nexus-only** change through the already-tested single-book optimistic commit/readback/conditional recovery path. It neither modifies Memory nor advances the per-chat Scene collection ledger or Hide boundary.
- 'nexusCollectionPolicy.js' refuses exact duplicate append content and no-op replacements to avoid repeated state accumulation. No rewriting of old legacy source blocks, side-prompt templates, canonical/STLO data, unrelated entries, manifest or main.
- Added 'nexusEditEvidence.test.js', 'nexusGroundedUpdateIntegration.test.js' and five small UI translation keys in each of 11 supported non-English locales. English source strings are included in UI JS; en*.json intentionally left untouched per upstream AGENTS.md.

### Verification, known limitations and rollback

- Isolated VPS Node suite: **435 tests, 433 PASS and the same two pre-existing upstream FAIL** in 'stmbJobsProgress.test.js' ('createViewSort is not defined'). Targeted source-evidence and Nexus-only mock-save tests PASS; JS syntax, Bun browser bundle and sourcemap, 26 locale JSON parse and Git whitespace checks PASS.
- Runtime still **not tested** on an actual SillyTavern Windows/Termux instance, real model responses, mobile popup or STLO/lore-manager simultaneous writes. Direct quotes are validated but model *interpretations* still require human review. Large model contexts and source windows can fail closed; no truncation or guaranteed two-request count. Legacy verbatim archive text has not been semantically restructured into canonical current state. Scene splitting, initial two-book creation and full clean UI remain pending.
- All changes are developer-branch only. No version/manifest bump, main merge, release ZIP or user World Info modification. Rollback point: **bb97c52b5b8c68aac1648a3054341c6e0114fa7d**.


## 2026-11-23 · One-time reviewed semantic Current Continuity reconstruction (development slice, NOT RELEASED)

### Defect and intended behavior

- Prior safe legacy migration copied old Scene Continuity/Status text verbatim into an always-on Current Continuity entry; old statements could therefore continue to be injected as if they were present facts. This new flow is **separate** from the original lossless migration; it never runs automatically.
- New explicit Sloth button: **Review old Current Continuity**. A migrated, unchanged legacy wrapper is a prerequisite. AI compares every verified old source UID with the currently visible original chat and proposes which assertions remain confirmed, and which are historical, resolved, superseded or unverified.
- Every newly active fact must cite both a short, **byte-exact quote from its old source entry** and an **exact current-chat message ID and quote**. Claiming resolution/supersession without a direct current-chat citation is rejected. If no facts are still corroborated, the original Current body is not modified. The system never infers recovery/completion from time or silence. Model judgment still requires user review.

### Changes and safety rails

- Pure module 'nexusLegacySemantic.js' inspects the original 'STMB_slothLegacySources' links and disabled archived original entries; verifies expected untouched '=== BEGIN/END ORIGINAL ... ===' wrappers; rejects pre-migration, manually modified, corrupted or previously reconciled Continuity. Validates model current/noncurrent classifications and source quotes. One-time staging replaces ONLY the active Current Continuity prose with named canonical Present Handoff / Active Threads / Knowledge Boundaries / Active Conditions sections that have current-chat evidence.
- The exact former active body is retained in the versioned 'STMB_slothContinuityReconciliation.originalContent' metadata; source UID/title/content snapshots and proposal evidence are retained too. All source entries themselves remain unchanged and disabled in the same Nexus file with **all** original metadata, including Side Prompt history, and every other NPC, Core, Outlet, Memory Scene and STLO structure is untouched. The prior active historical text is **not** silently erased: removing it from current injection is shown prominently in the approval popup and explicitly approved after a full original Nexus JSON backup. Idempotence and receipt tampering are checked.
- 'nexusCollectionAI.js' adds an explicit provider-only proposal using the existing evidence window helper, no writes. 'nexusCollectorRuntime.js' wires candidate generation, source-chat fingerprint and role checks after async steps, complete before/after and exclusion review, full backup download, single-book optimistic server conflict check/write/read-back/conditional compensation. No auto collection, Scene creation, Hide, collected-message ledger update or Nexus role switching.
- 'index.js' adds the manual review button; 'templates.js' adds one hint. 14 new locale keys translated across 11 non-English JSON files; en*.json untouched per upstream AGENTS.md. Existing Scene-merge UI test had overbroad slicing to the end of nexusCollectorRuntime.js, so its test scope was narrowed to its own function when a new export was appended; no change to merge runtime behavior.

### Validation and limitations

- Isolated VPS developer-clone Node full suite: **447 tests, 445 PASS / two pre-existing upstream FAIL**, both 'stmbJobsProgress.test.js / createViewSort is not defined'. New pure archive/ref validation, tamper and source-corroboration tests, simulated single-book commit/rollback and existing UI/translation and merge regression tests pass.
- Bun browser bundle and source map, JavaScript syntax, all 26 locale JSON parses, Git whitespace check PASS. Before remote write, compare GitHub Git tree SHA against tested staged tree SHA.
- This is an opt-in **high-impact content change** that requires explicit user review: old facts without CURRENT corroboration leave the active context (but survive in archived original entries, metadata and downloaded backup). Do not claim AI's semantic interpretation has been field-validated. Real Windows/Termux SillyTavern, model, provider, browser download/popup, mobile and STLO/lore-manager integration remain unverified. Complex altered legacy data is blocked. Already saved Scene splitting and full clean UI still pending.
- Change scope: development branch only. No manifest/version bump, main merge, ZIP publication, live user World Info or installation modification. Rollback point: '0c048d116e3a0944f2c5529a6ea3081525c3550b'.


## 2026-11-23 · Manually reviewed newest completed Scene split (developer-only; NOT a release)

### Scope and reason

- Previously implemented merge could join two saved completed Scenes, but the reverse operation was unavailable. A single existing Scene could contain independent finished causal incidents and remain indivisible for future recall.
- This first safe slice **ONLY splits the newest completed numbered Scene in a character's currently saved chat**, **ONLY when every original source message is visible** and source spans/UIDs are verifiable. This deliberate restriction prevents renumbering earlier Scenes or silently altering existing canonical/STLO references. Older Scenes, previously split/merged Scenes, advanced STLO root or cross-entry references, missing chat identity, hidden/blank original messages, ambiguous numbering and conflicting source spans are blocked. No claim of general legacy Scene splitting.

### Implementation

- Added 'nexusSceneSplitArchives.js': pure provenance range parser and archive-child link validator, including exact original full-record snapshot, no source message lost or assigned twice, archived original disabled and never re-enabled, and orphan/tampered metadata rejection.
- 'nexusSceneRotation.js' now validates this split history and excludes only intact split archives from the recent-3 activation/keyword-vector recall, while leaving existing merged-history logic intact. The old numbered Scene remains present as a disabled archive; new complete Scenes take fresh later sequence numbers and UIDs. Older Scene numbering and content are unchanged.
- 'nexusSceneSplit.js' inspects source history, selects **latest completed Scene only**, validates AI's 2-4 independently completed incidents with verbatim in-part current-chat evidence and exhaustive original message coverage (including discontiguous ranges), orders replacement Scenes by **actual final source message ID**, stages cloned Memory book and full source snapshot. Each new Scene uses Timeline / Scene / completed Result; existing source history and metadata remain preserved. No automatic Hide or collection-ledger changes.
- 'nexusCollectionAI.js' has a manual, read-only AI split analyzer that prefers NO SPLIT over an invented incident, rejects context beyond its safe untruncated budget, and reuses the existing Scene prose writer. The existing optional precision omission audit can be enabled to inspect proposed drafts before saving.
- 'nexusCollectorRuntime.js' and 'index.js' wire three explicit reviews: editable event titles/source ranges, editable completed Scene bodies, final original-and-new comparison + **full original Memory JSON download and explicit approval**. Commit reuses the existing Memory-only optimistic server reread/save/read-back/conditional rollback, chat fingerprint and role protection. Memory is the only written lorebook; Nexus, Side Prompts, characters, chat, Hide and collection receipts are untouched. New 16 UI translation keys in 11 non-English locales; no changes to en*.json or upstream manifest/version.
- New tests 'nexusSceneSplit.test.js' and 'nexusSceneSplitIntegration.test.js' cover untouched original provenance, out-of-order evidence, missing/duplicate/hidden/cross-AU messages, independent Scene preservation, rotation after later collection, keyword retrieval of older entries without archive reactivation, stale writer conflicts, failed-save rollback, manual UI and localization.

### Limitations, rollback and release

- Tests are against isolated developer-clone pure functions and simulated World Info reads/writes. **Not yet verified inside running SillyTavern** on Windows/Termux, desktop/mobile Popup or actual AI model. The original chat may already be hidden; those incidents are safely blocked until a separate, explicitly reviewed recovery path exists.
- The AI's semantic distinction between genuinely independent incidents remains a judgment requiring explicit human review. Exact quote/coverage checks do not prove that every unique character voice, habit or emotional nuance survived rewriting; the unchanged original is retained in the disabled entry and original JSON backup. This is a feature slice, not finished general Scene splitting.
- VPS isolation validation: **461 Node tests, 459 PASS, only two pre-existing upstream FAIL** (stmbJobsProgress.test.js / createViewSort is not defined). Bun browser bundle and source map, all changed JS syntax, 26 locale JSON parse, targeted split/merge/rotation/single-book rollback tests and Git whitespace check PASS. GitHub staged/remote tree SHA must match before publishing the development commit. Keep PR #1 Draft, never merge main or change manifest/version, create release ZIP or touch actual user World Info before real runtime QA. Rollback point: '0cd12a1e31121f17596a2046fde04d03fb6aceb0'.

## 2026-11-23 · Follow-up review after initial setup and bundled build (development only)

- **Baseline:** GitHub `feature/nexus-memory-rotation` at `c667b5856e5d69b3489125649861a1711dd678ed`, following `563f153` initial two-book setup. The VPS isolation worktree is separate from the prior worktree; no user's SillyTavern install, real lorebooks, chat, manifest, version or main branch is changed.
- **Regression corrected:** `nexusEditEvidence.test.js` still asserted that every empty Current Continuity replacement must fail. The newly approved `observed_resolution / observed_correction / explicit_retraction` retirement policy permits deletion of exactly one cited, fully ended line. Updated the test to require evidence and allowed supersession; added a section-level test proving unrelated Continuity sections, NPC and STMB history remain intact and partial-line removal is rejected.
- **New safety guard:** `fingerprintSlothChat` now captures both the originally selected source message values **and the entire chat length**. If another turn is added while the AI analyzes or the approval popup is open, the old candidate's current-state changes cannot be committed silently. The previous check only compared selected message IDs and missed appended turns. Added a regression test for this specific race; no content/metadata is changed by the check.
- **Checks:** Node suite 472/472 PASS in the VPS's independent copy, including the preceding source-only tests. Build artifact is regenerated with the repository's pinned Bun v1.3.2 build script, JS syntax checks and source-map provenance checks. Compilation/automatic tests are **not** a claim of actual SillyTavern desktop/Termux/mobile or model-quality validation.
- **Risks and scope:** The added chat-length fingerprint intentionally rejects a pending operation even if a new turn is unrelated; restart the reviewed operation instead of saving stale state. Semantic correctness of an AI-proposed retirement still requires the user's review. First-book creation and legacy references still need actual SillyTavern QA. Keep Draft PR, no installation, main merge, release or version bump. **Rollback target:** `c667b58`.

## 2026-11-23 · Reviewed collector UX, editable Nexus/Scene drafts, clean Sloth navigation (staging only)

- Starting from \`7e91111926dda2feec5466f16b75e2575746e399\` in a **separate VPS worktree** (\`/tmp/memorybooks-qa-sandbox-20261123\`); use current remote branch head when resuming rather than this snapshot if the branch has moved.
- The manual Sloth workflow now has an always-visible AI profile selector, short collection steps, character-linked Nexus/Memory roles and first-book/companion actions. Existing legacy Memory Books controls are retained under a collapsed original-tools section when Sloth is active. The original manual Create Memory footer buttons are not offered in Sloth mode to avoid sending the user down the wrong collection path; ordinary Memory Books mode is unchanged. UI inherits ST theme styles and supports narrow mobile width, with no global CSS or web fonts.
- During the **final reviewed collection save**, the user can now edit each approved Scene's title, full narrative and exactly five recall keywords, and can edit each proposed Nexus operation's replacement/append/create text and new detail keywords. New pure helper \`nexusCollectionReview.js\` validates the form shape and Scene output while keeping source ranges, operation kind/UID, original excerpt, reason and verified citations outside the editable surface. \`nexusCollectorRuntime.js\` restages **both entire candidate books from original snapshots** and reruns the existing grounded-evidence and Continuity boundary guards before backup/commit. Invalid edits reject saving; no partial book mutation occurs from a cancelled draft.
- Added \`nexusCollectionReview.test.js\` for editable text persistence, original source ranges, refusal of bad Scene shape/keys, preserved read-only Nexus evidence and special Outlet content, rejection of inserted headings, and UI wiring. Updated the pre-existing UI test to match the new computed Sloth setup state. Added seven translated interface keys to each of 11 non-English locales; \`en*.json\`, manifest, version, main, old data and all other extension assets remain unchanged.
- Isolated Node suite: **477/477 PASS**. Original Bun 1.3.2 build \`bun run build.ts\` PASS, JS syntax PASS, all 26 locales parse. Browser JS/CSS and external sourcemap rebuilt. These are compilation and automatic tests, **not** live SillyTavern/PC/mobile/model/World Info/STLO/lore-manager integration acceptance.
- Remaining before release: actual isolated SillyTavern UI + mobile functional run for new collection setup, missing-book companion, long chats, review/title edits, backup, server writes/reads and conflict recovery; AI causality/attribution quality against real original chats; vector/keyword/Outlet/STLO/lore-manager interactions; legacy merged/split histories. Keep Draft PR, no install/main/manifest/version/release. **Rollback**: \`7e91111\`.


## 2026-11-25 · Remove mandatory Nexus quotation receipts; retain structural safeguards

- Baseline: `bc1d007e75252e49b0d865613c13b2e7367218d8`. User requested removal of mandatory literal chat citations for normal Nexus collection. Remove the reason/evidence output requirement, per-edit source-quote gate and literal NPC-name proof gate. The original chat still guides the model; keep the exact existing-span, UID, role, duplicate, section, protected-entry, chat-origin and save/rollback safeguards. Whole-line retirement still requires an explicit resolution/correction/retraction classification; no quotation receipt. Existing stored memories are unchanged.
- Keep independent Scene/event range and legacy reconciliation evidence checks; those are not the ordinary Nexus update gate. No added model call, observer, timer or redraw path.
- Fix invalid UID coercion (null/blank/boolean/array must not become UID 0). Index original Scene entries by UID once instead of scanning all records for each rotation.
- Node regression suite: 542 passing in isolation (obsolete quote-gate tests removed/replaced); rebuild browser bundle and source map with Bun 1.3.2. Real model responses, installed SillyTavern/Termux/iOS and long-running RP not exercised. Rollback: restore previous code and bundled output; preserve all user data.


## Reader-facing Side Prompt examples (2026-11-26)

Diary is unchanged. NPC Directory and Memorable Quotes are optional built-ins, with no injection by default. Existing independent always-on, vector, keyword and no-injection paths apply to built-ins and custom presets. Quotes require original chat messages; no reconstruction from summaries. Nexus collection is unchanged. Existing destinations, review and save routes are reused.

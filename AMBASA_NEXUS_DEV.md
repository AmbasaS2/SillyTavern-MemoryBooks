# 🦥 게으름뱅이 시스템 · Memory Books fork development

Project: [AmbasaS2/SillyTavern-MemoryBooks](https://github.com/AmbasaS2/SillyTavern-MemoryBooks), forked from [aikohanasaki/SillyTavern-MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks) v9.4.0 / `5a79f667` (AGPL-3.0).

This branch is **unfinished development**, not a released or verified SillyTavern extension. `main` and the upstream source must remain unchanged until the full collector is tested.

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

- Evidence-preserving migration of legacy Long-Term Memory / Scene Continuity / Status to separate Core Memory and sectioned Current Continuity. The new collector intentionally blocks unreviewed legacy input to prevent destructive replacement.
- AI-assisted merge or split of already saved Scene memories, preserving UID/source references.
- Full branch-copy policies for copying lorebook contents are still missing. Per-chat AU role overrides now isolate book selection, but existing collection data is not migrated between books and chats can still intentionally reference the same book.
- Truly atomic two-book writes are not available over two independent SillyTavern World Info endpoints; compensation is best effort, not a database transaction.
- Long-chat provider quality evaluation and token handling, original user PC/mobile SillyTavern UI tests, STLO vector recall and lore-manager synchronization, whole-extension clean digital UI redesign.
- User-approved install/release and version/manifest adjustment or main merge.


## Testing and release safety

Run `node --check` on changed JS, `node --test` and `bun run build.ts`; commit both `index.build.js` + map and `style.build.css` after rebuilding. Node test failures present in unchanged upstream `stmbJobsProgress.test.js` are tracked separately from regressions in this fork.

No manifest/version bump, main merge, live lorebook write or new ZIP release before actual SillyTavern tests. For design decisions, source revision and work log see [Notion](https://app.notion.com/p/421a96b06fd4816b9778fe6a60046d54).

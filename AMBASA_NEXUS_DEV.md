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

### Scene rotation (first integration)

- Keeps the latest three numbered, **completed** Scene entries constant/always-on. Older complete Scenes become vector-recalled, or keyword-recalled when existing keywords are present.
- Stages the change against a clone before the original World Info save. Failing validation/save does not modify the user's source book in memory.
- Rejects mixed/unnumbered/incomplete Scene structures and duplicates; preserves each entry's content, custom Outlets, STMB/STLO metadata, position and order.
- Legacy opt-in rotation for dedicated books named `Memory` or `Memory-...` remains for users who have not assigned character roles.

### UI and localization

- Sloth's new role settings use small, responsive **clean UI** cards scoped to `.stmb-popup`, ST theme colors and inherited font, with a single-column mobile layout. Existing Memory Books screens are still largely upstream and **not yet fully redesigned**.
- Labels follow the 🦥 naming convention; short mode and 3-Scene setting use 🦥 게으름뱅이.
- Translated new controls/explanations in Korean and supported non-English locale JSON; en*.json untouched per upstream AGENTS.md.

## Not implemented yet

- The central AI pipeline: manually analyze a long accumulated chat, decide the number of complete causal events/Scenes, preview suggested **titles/message ranges** and seek approval, then write Scene bodies.
- Automated Nexus **Core Memory**, **Current Continuity** (Scene Continuity + Status), LT and NPC edit/new-entry plan and safe two-book commit/rollback.
- AI-assisted merging of previously split Scene memories, optional expensive omission verification, per-chat role overrides for separate AUs, branch-copy isolation.
- Whole-extension clean UI redesign, performance/screenshot/device QA, runtime checks inside user's SillyTavern desktop/mobile environment and STLO/lore-manager integration.

## Testing and release safety

Run `node --check` on changed JS, `node --test` and `bun run build.ts`; commit both `index.build.js` + map and `style.build.css` after rebuilding. Node test failures present in unchanged upstream `stmbJobsProgress.test.js` are tracked separately from regressions in this fork.

No manifest/version bump, main merge, live lorebook write or new ZIP release before actual SillyTavern tests. For design decisions, source revision and work log see [Notion](https://app.notion.com/p/421a96b06fd4816b9778fe6a60046d54).

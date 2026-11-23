# Memory Books → Nexus / Memory fork

This is **work in progress** on the user-owned fork of `aikohanasaki/SillyTavern-MemoryBooks` (AGPL-3.0), starting from v9.4.0 / commit `5a79f667`.

## First implementation slice

Opt-in General Settings control: after a manually approved Scene save to a dedicated World Info book named `Memory` or starting with `Memory-`, keep the newest three **numbered, completed** Scenes always-on. Older Scenes use vector recall, or keyword recall if **every old Scene already has keywords**. The rotation is staged before the original World Info save; failures leave existing book data unchanged. Only `constant`, `vectorized` and keyword-mode `selective` are changed. Other entry and STLO fields are preserved. Mixed lorebooks, duplicate numbering, incomplete scenes and disabled recent scenes fail closed. Scene **numbers in titles**, not UID or in-world dates, determine the order.

When enabled, automatic summaries, reminder toasts and message auto-hide are disabled. Existing settings and behavior are unchanged by default.

Run `node --test nexusSceneRotation.test.js` and the full `node --test` suite.

## Not yet delivered

Full AI event analysis and multi-Scene title/range approval; automatic Nexus Core Memory/Current Continuity/LT/NPC updates; existing Scene merge; two-book transactional save; runtime browser QA. The extension loads `index.build.js`; source changes require regeneration of that bundle before installation. **Do not install this feature branch as a release until the bundle is built and tested.**

Development decisions are tracked in Notion: https://app.notion.com/p/421a96b06fd4816b9778fe6a60046d54

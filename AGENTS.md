# Project Directives

## Sloth's Memory Books fork — current source of truth

- Read `manifest.json`, `readme.md` and the dated **Current main status** at the top of `AMBASA_NEXUS_DEV.md` first. Resolve the actual target branch and HEAD before making changes. The rest of that development log is historical, not an active release gate.
- The fork automates the Sloth Nexus/Memory workflow inside SillyTavern; keep Original mode intact. Preserve existing memory content, character/AU boundaries, original message ranges, special Outlets and activation settings except for intended recent-scene rotation. Never infer that legacy ranges are verified solely from numeric metadata.
- Separate model-quality checks from deterministic storage, rotation and Hide checks. A valid JSON response does not prove a completed event or faithful summary. Before a runtime release, build and test the changed code and report unverified environments. Documentation-only corrections do not require a version bump or bundle rebuild.


- Prioritize correctness and data fidelity. 
- Bugfix code edits should try to be as surgical as possible with the least effect on adjacent code or non-pipeline imports/exports.
- If a better solution exists but requires more code change, you should propose it. Always present the pros and cons of your proposals. 
- After code edits, do a line-by-line code walk through affected/touched functions as well as imports/exports to ensure no unintended semantic regressions.
- Always ignore all en*.json files.
- ignore edits to changelog.md and manifest.json unless you are specifically requested to review them.
- Before finishing, add any new localization keys to locales/*.json (except ignored files) and ensure translation is done.

# Style Guide

- Strongly prefer reusing existing functions and CSS styles (including from ST base) whenever possible.
- Translations must use consistent translated vocabulary for key phrases such as "Memory Books", "lorebook", "side prompt", etc. Always review and locate the important phrases as translated elsewhere in the locales/*.json file in order to identify translation for the key phrases. 

# Documentation

- For the current fork workflow, use `readme.md` and the current section of `AMBASA_NEXUS_DEV.md`. `userguides/1 Memory_Books_AI_Reference_Manual.md` primarily documents the upstream/Original workflow; update relevant sections without rewriting unrelated upstream features. 

# Historical upstream READ-ONLY reference paths

These are the upstream developer's example paths, not requirements or locations on the current machine. Resolve the actual SillyTavern checkout and installed extension when testing.

- SillyTavern base/upstream: "D:\ST\SillyTavern"
- Aikobots v2: "C:\Users\alcho\Aikobots Code\Aikobots"
- SillyTavern-LorebookOrdering (STLO): "C:\Users\alcho\Aikobots Code\SillyTavern-LorebookOrdering"
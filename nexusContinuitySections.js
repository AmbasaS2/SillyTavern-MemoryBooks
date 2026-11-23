// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Loss-averse, section-scoped Current Continuity updates. No server writes.

export const CONTINUITY_SECTIONS = Object.freeze([
    'Present Handoff', 'Active Threads', 'Knowledge Boundaries', 'Active Conditions',
]);

const HEADER = /^(?:#{1,6}[ \t]+([^\r\n]+)|\*\*([^\r\n]+)\*\*|\[([^\r\n]+)\])[ \t]*\r?$/gm;
const RAW_BLOCK = /=== BEGIN ORIGINAL ([^\r\n]+) ===\r?\n[\s\S]*?\r?\n=== END ORIGINAL ([^\r\n]+) ===/g;
const safe = (value, message) => { if (!value) throw new Error(message); };
const sectionName = value => CONTINUITY_SECTIONS.find(name =>
    name.toLowerCase() === String(value || '').trim().toLowerCase()) || '';

function sectionsOf(content) {
    const matches = [];
    const names = new Set();
    for (const match of String(content).matchAll(HEADER)) {
        const name = sectionName(match[1] || match[2] || match[3]);
        if (!name) continue;
        safe(!names.has(name), 'Current Continuity has duplicate section: ' + name);
        names.add(name);
        matches.push({ name, start: match.index, header: match[0],
            bodyStart: match.index + match[0].length });
    }
    return {
        preamble: String(content).slice(0, matches[0]?.start ?? String(content).length),
        sections: matches.map((item, index) => ({
            ...item,
            body: String(content).slice(item.bodyStart,
                matches[index + 1]?.start ?? String(content).length),
            end: matches[index + 1]?.start ?? String(content).length,
        })),
    };
}

function rawArchives(content) {
    const text = String(content);
    const blocks = [...text.matchAll(RAW_BLOCK)];
    const opens = text.match(/=== BEGIN ORIGINAL\b/g) || [];
    const ends = text.match(/=== END ORIGINAL\b/g) || [];
    safe(opens.length === blocks.length && ends.length === blocks.length &&
        blocks.every(match => match[1] === match[2]),
        'Current Continuity has an incomplete or conflicting legacy source archive.');
    return blocks.map(match => match[0]);
}

/** A new Continuity entry needs a named section, never an unstructured overwrite. */
export function guardNewContinuityContent(content) {
    safe(typeof content === 'string' && !!content.trim(),
        'New Current Continuity needs source-backed content.');
    const parsed = sectionsOf(content);
    safe(parsed.sections.length > 0 && rawArchives(content).length === 0,
        'New Current Continuity must use a named section and cannot forge old archives.');
}

/** Reject edits that silently remove/move a canonical section or a verbatim legacy source. */
export function guardContinuityChange(before, after, { action = '', section = '' } = {}) {
    safe(typeof before === 'string' && typeof after === 'string',
        'Current Continuity text must remain a string.');
    safe(JSON.stringify(rawArchives(before)) === JSON.stringify(rawArchives(after)),
        'Original Scene Continuity / Status source archive must remain byte-for-byte unchanged.');
    const old = sectionsOf(before), next = sectionsOf(after);
    if (!old.sections.length) {
        // Older unstructured entries have no verified section boundary. In this
        // case only a new, explicitly named section may be appended.
        safe(action === 'append_section' && sectionName(section) &&
            after.startsWith(before),
            'Unstructured Current Continuity requires a reviewed append_section operation.');
        safe(next.sections.length === 1 && next.sections[0].name === sectionName(section),
            'Continuity append must create only the named section.');
        return;
    }
    if (action === 'append_section' &&
        !old.sections.some(item => item.name === sectionName(section))) {
        safe(after.startsWith(before),
            'Adding a Continuity section must leave all existing text untouched.');
        safe(next.sections.length === old.sections.length + 1 &&
            next.sections.at(-1).name === sectionName(section),
            'New Continuity section must be appended after existing sections.');
        safe(old.sections.every((item, i) =>
            next.sections[i].name === item.name && next.sections[i].header === item.header &&
            next.sections[i].start === item.start),
            'Existing Continuity headings were changed.');
        return;
    }
    safe(next.preamble === old.preamble &&
        next.sections.length === old.sections.length &&
        old.sections.every((item, i) => next.sections[i].name === item.name &&
            next.sections[i].header === item.header),
        'Current Continuity section headings or unrelated preamble changed.');
    const modified = old.sections.filter((item, i) => item.body !== next.sections[i].body);
    safe(modified.length <= 1,
        'Current Continuity edit spans more than one section. Use separate reviewed edits.');
    if (action === 'append_section') {
        safe(modified.length === 1 && modified[0].name === sectionName(section),
            'Continuity appendix changed a different section.');
    }
}

/** Explicitly add a grounded fact to a named section without rewriting neighboring sections. */
export function appendContinuitySection(before, section, text) {
    const name = sectionName(section);
    safe(name, 'Unknown Current Continuity section.');
    safe(typeof text === 'string' && !!text.trim(),
        'Current Continuity section addition must contain grounded text.');
    safe(!/^(?:#{1,6}[ \t]+\S.*|\*\*[^\r\n]+\*\*|\[[^\r\n]+\])[ \t]*\r?$/m.test(text) &&
        !/=== (?:BEGIN|END) ORIGINAL\b/.test(text),
        'Continuity addition cannot introduce another section or legacy archive marker.');
    const old = sectionsOf(before);
    const target = old.sections.find(item => item.name === name);
    let after;
    if (target) {
        // Insert before the following heading, preserving the existing body and
        // every other heading. No trim/reformat is applied to the source text.
        const prefix = before.slice(0, target.end);
        after = prefix + (prefix.endsWith('\n') ? '\n' : '\n\n') +
            text.trim() + '\n\n' + before.slice(target.end);
    } else {
        after = before + (before.endsWith('\n') ? '\n' : '\n\n') +
            '## ' + name + '\n' + text.trim();
    }
    guardContinuityChange(before, after, { action: 'append_section', section: name });
    return after;
}

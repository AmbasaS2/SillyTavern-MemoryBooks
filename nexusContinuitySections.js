// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Loss-averse, section-scoped Current Continuity updates. No server writes.

export const CONTINUITY_SECTIONS = Object.freeze([
    'Present Handoff', 'Active Threads', 'Knowledge Boundaries', 'Active Conditions',
]);

const HEADER = /^(?:#{1,6}[ \t]+([^\r\n]+)|\*\*([^\r\n]+)\*\*|\[([^\r\n]+)\])[ \t]*\r?$/gm;
const RAW_BLOCK = /=== BEGIN ORIGINAL ([^\r\n]+) ===\r?\n[\s\S]*?\r?\n=== END ORIGINAL ([^\r\n]+) ===/g;
const safe = (value, message) => { if (!value) throw new Error(message); };
const LEGACY_SECTIONS = new Map([
    ['active threads - still unconfirmed', 'Active Threads'],
    ['physical carryover', 'Active Conditions'],
]);
const sectionName = (value, legacyHeadings = false) => {
    const key = String(value || '').trim().toLowerCase().replace(/[–—]/gu, '-');
    return CONTINUITY_SECTIONS.find(name => name.toLowerCase() === key) ||
        (legacyHeadings && LEGACY_SECTIONS.get(key)) || '';
};

function sectionsOf(content, legacyHeadings = false) {
    const matches = [];
    const names = new Set();
    for (const match of String(content).matchAll(HEADER)) {
        const name = sectionName(match[1] || match[2] || match[3], legacyHeadings);
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

export function legacyContinuitySectionStart(content) {
    return sectionsOf(content, true).sections[0]?.start ?? -1;
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
export function guardContinuityChange(before, after, { action = '', section = '', legacyHeadings = false } = {}) {
    safe(typeof before === 'string' && typeof after === 'string',
        'Current Continuity text must remain a string.');
    safe(JSON.stringify(rawArchives(before)) === JSON.stringify(rawArchives(after)),
        'Original Scene Continuity / Status source archive must remain byte-for-byte unchanged.');
    const old = sectionsOf(before, legacyHeadings), next = sectionsOf(after, legacyHeadings);
    const name = sectionName(section, legacyHeadings);
    if (!old.sections.length) {
        // Older unstructured entries have no verified section boundary. In this
        // case only a new, explicitly named section may be appended.
        safe(action === 'append_section' && name &&
            after.startsWith(before),
            'Unstructured Current Continuity requires a reviewed append_section operation.');
        safe(next.sections.length === 1 && next.sections[0].name === name,
            'Continuity append must create only the named section.');
        return;
    }
    if (action === 'append_section' &&
        !old.sections.some(item => item.name === name)) {
        safe(after.startsWith(before),
            'Adding a Continuity section must leave all existing text untouched.');
        safe(next.sections.length === old.sections.length + 1 &&
            next.sections.at(-1).name === name,
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
        safe(modified.length === 1 && modified[0].name === name,
            'Continuity appendix changed a different section.');
    }
}

/** Explicitly add a grounded fact to a named section without rewriting neighboring sections. */
export function appendContinuitySection(before, section, text, {legacyHeadings = false} = {}) {
    const name = sectionName(section, legacyHeadings);
    safe(name, 'Unknown Current Continuity section.');
    safe(typeof text === 'string' && !!text.trim(),
        'Current Continuity section addition must contain grounded text.');
    if (legacyHeadings) {
        // Keep a model's leading label as inline prose, without letting it
        // introduce or move a real heading in the saved mixed entry.
        const leading = text.match(/^\[([^\r\n\]]+)\][ \t]*\r?\n([\s\S]+)$/u);
        if (leading && !sectionName(leading[1], true)) {
            text = '**' + leading[1] + ':** ' + leading[2].trimStart();
            safe(!before.includes(text.trim()), 'Nexus addition already exists; refusing a repeated append.');
        }
    }
    safe(!/^(?:#{1,6}[ \t]+\S.*|\*\*[^\r\n]+\*\*|\[[^\r\n]+\])[ \t]*\r?$/m.test(text) &&
        !/=== (?:BEGIN|END) ORIGINAL\b/.test(text),
        'Continuity addition cannot introduce another section or legacy archive marker.');
    const old = sectionsOf(before, legacyHeadings);
    const target = old.sections.find(item => item.name === name);
    let after;
    if (target) {
        // Insert before the following heading, preserving the existing body and
        // every other heading. No trim/reformat is applied to the source text.
        // In the legacy Active Threads layout, keep a new general note above
        // its existing named threads, which each own their following text.
        const insertAt = legacyHeadings && /^\[Active threads [–—-] still unconfirmed\]/iu.test(target.header)
            ? target.bodyStart : target.end;
        const prefix = before.slice(0, insertAt);
        after = prefix + (prefix.endsWith('\n') ? '\n' : '\n\n') +
            text.trim() + '\n\n' + before.slice(insertAt);
    } else {
        after = before + (before.endsWith('\n') ? '\n' : '\n\n') +
            '## ' + name + '\n' + text.trim();
    }
    guardContinuityChange(before, after, { action: 'append_section', section: name, legacyHeadings });
    return after;
}

/** Identify protected knowledge-boundary changes without interpreting prose. */
export function touchesContinuityKnowledge(edit,existing=''){
    if(edit.action==='append_section')return sectionName(edit.section,true)==='Knowledge Boundaries';
    if(edit.action==='create')return sectionsOf(String(edit.content||''),true).sections.some(section=>section.name==='Knowledge Boundaries');
    if(edit.action!=='replace_exact'||typeof edit.find!=='string'||!edit.find)return false;
    const text=String(existing||''),start=text.indexOf(edit.find);
    if(start<0||text.indexOf(edit.find,start+1)!==-1)return false;
    return sectionsOf(text,true).sections.some(section=>section.name==='Knowledge Boundaries'&&
        start>=section.bodyStart&&start+edit.find.length<=section.end);
}

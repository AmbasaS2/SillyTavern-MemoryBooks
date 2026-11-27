// Read-only preview; translation file format/lookup matches WorldInfoInfo cc78436.
// No persistent cache, timers, book scans, translation requests or writes.
import { readManagerTranslationBook, managerTranslatedTitle, managerTranslatedBody } from './lore-manager-translations.js';

export function createSlothHealthTranslationSession(book, request, headers, legacySettings, enabled) {
    let pending = null, snapshot = null;
    return {
        load() {
            if (!pending) pending = (enabled
                ? readManagerTranslationBook(book, request, headers)
                : Promise.resolve(null)).then(result => { snapshot = result; });
            return pending;
        },
        get started() { return pending !== null; },
        title(row) {
            return enabled ? managerTranslatedTitle({world:book,uid:row.uid,comment:row.title,content:row.body},snapshot,legacySettings) : '';
        },
        body(row) {
            return enabled ? managerTranslatedBody({world:book,uid:row.uid,comment:row.title,content:row.body},snapshot,legacySettings) : null;
        },
    };
}

// WorldInfoInfo presentation-only normalization; source text is never modified.
function formatLoreReaderMarkdown(source) {
    const lines = String(source ?? '').split(/\r?\n/);
    let fenceChar = '', fenceLength = 0;
    for (let i = 0; i < lines.length; i++) {
        const fence = lines[i].match(/^ {0,3}(\x60{3,}|~{3,})/);
        if (fence) {
            if (!fenceChar) {
                fenceChar = fence[1][0];
                fenceLength = fence[1].length;
            } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
                fenceChar = '';
                fenceLength = 0;
            }
            continue;
        }
        if (fenceChar) continue;
        const decorated = lines[i].match(/^ {0,3}={3,}[ \t]*(.+?)[ \t]*={3,}[ \t]*$/);
        if (decorated && decorated[1].trim()) {
            lines[i] = '### ' + decorated[1].trim();
            continue;
        }
        const bracketed = lines[i].match(/^ {0,3}\[([^\[\]\n]{3,100})\][ \t]*$/);
        if (bracketed && bracketed[1].trim()) {
            lines[i] = '#### ' + bracketed[1].trim();
        }
    }
    return lines.join('\n');
}

export function createSlothHealthMarkdownRenderer(Converter, sanitize) {
    let converter;
    return (target, value) => {
        const content = String(value ?? '');
        try {
            converter ??= new Converter({
                emoji:true, literalMidWordUnderscores:true, parseImgDimensions:true,
                tables:true, simpleLineBreaks:true, strikethrough:true, underline:true,
            });
            target.innerHTML = sanitize(converter.makeHtml(formatLoreReaderMarkdown(content)), {
                USE_PROFILES:{html:true},
                FORBID_TAGS:['style','script','iframe','object','embed','form','input','select','button','textarea'],
                FORBID_ATTR:['style'],
            });
        } catch {
            target.textContent = content;
        }
    };
}

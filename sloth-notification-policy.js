// Sloth fork: brand only the extension's own notifications; never modify global toastr.
export function slothNotificationTitle(locale, title) {
    const name = /^ko(?:[-_]|$)/i.test(String(locale || '')) ? '메모리북' : 'STMemoryBooks';
    const raw = String(title ?? '').trim();
    if (raw.startsWith('🦥')) return raw;
    const ordinary = new Set(['', 'STMemoryBooks', 'Memory Books', 'MemoryBooks', '메모리북', '게으름뱅이의 메모리북', 'Memory Books (Sloth)', "Sloth's Memory Books"]);
    return '🦥 ' + name + (ordinary.has(raw) ? '' : ' · ' + raw);
}

export function createSlothToastr(getNative, getLocale) {
    const send = level => (message, title, ...options) => {
        const native = getNative();
        if (!native?.[level]) return undefined;
        let locale = '';
        try { locale = getLocale(); } catch { /* fall back to English */ }
        return native[level](message, slothNotificationTitle(locale, title), ...options);
    };
    return Object.freeze({
        error: send('error'),
        warning: send('warning'),
        info: send('info'),
        success: send('success'),
        clear: (...args) => {
            const native = getNative();
            return native?.clear?.(...args);
        },
    });
}

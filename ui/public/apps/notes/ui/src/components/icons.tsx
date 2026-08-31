const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Caret = () => <svg width="10" height="10" viewBox="0 0 16 16" {...s}><path d="M6 3.5L10.5 8 6 12.5" /></svg>;
export const Plus = () => <svg width="13" height="13" viewBox="0 0 16 16" {...s}><path d="M8 3.5v9M3.5 8h9" /></svg>;
export const Dots = () => <svg width="13" height="13" viewBox="0 0 16 16" {...s}><path d="M3.5 6.5h9M3.5 9.5h6" /></svg>;
export const Close = () => <svg width="16" height="16" viewBox="0 0 16 16" {...s}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Search = () => <svg width="14" height="14" viewBox="0 0 16 16" {...s}><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L13.5 13.5" /></svg>;
export const Menu = () => <svg width="17" height="17" viewBox="0 0 16 16" {...s}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></svg>;
export const Trash = () => <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" /></svg>;

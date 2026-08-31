const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Plus = () => <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}><path d="M8 3.5v9M3.5 8h9" /></svg>;
export const Close = () => <svg width="16" height="16" viewBox="0 0 16 16" {...stroke}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Chevron = () => <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}><path d="M6 3.5L10.5 8 6 12.5" /></svg>;
export const Note = () => <svg width="11" height="11" viewBox="0 0 16 16" {...stroke}><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5" /></svg>;
export const Link = () => <svg width="12" height="12" viewBox="0 0 16 16" {...stroke}><path d="M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.8.8" /><path d="M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.8-.8" /></svg>;
export const Trash = () => <svg width="15" height="15" viewBox="0 0 16 16" {...stroke}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" /></svg>;

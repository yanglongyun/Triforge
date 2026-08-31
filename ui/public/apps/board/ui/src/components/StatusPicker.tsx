interface Def { id: string; label: string; hue: number }

/** 状态选择器。一排 chip，当前项高亮 —— 手机上不用弹菜单，一下就点到。 */
export function StatusPicker<T extends string>(
  { options, value, onPick, label }: { options: readonly Def[]; value: T; onPick: (id: T) => void; label: string },
) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="chip tone"
          style={{ '--hue': option.hue } as React.CSSProperties}
          aria-pressed={option.id === value}
          onClick={() => onPick(option.id as T)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// 开关。用在「状态一眼可见」的地方 —— 图标按钮做不到这点:
// 一个图钉是「已钉住」还是「点了就钉住」,不点一下不知道;开关的左/右位置本身就是答案。
export function Switch({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  /** 无障碍名称(屏读器念它);界面上另有文字时不必重复显示。 */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={[
        "shrink-0 relative w-9 h-5 rounded-full transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        on ? "bg-accent" : "bg-border",
      ].join(" ")}
    >
      <span
        className={[
          // left-0 必须写死:absolute 不写 left 会落回「静态位置」,而按钮内容居中,
          // 静态位置 = 正中,translate 再一叠加,滑块就整个滑出轨道
          "absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[18px]" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}

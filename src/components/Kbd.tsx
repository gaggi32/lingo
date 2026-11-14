/** A key cap, worn by a control to show the shortcut that also drives it. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded border border-slate-300 bg-white px-1 py-px font-sans text-[10px] font-normal leading-none text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
      {children}
    </kbd>
  );
}

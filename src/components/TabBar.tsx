"use client";

export type TabId = "write" | "history" | "settings";

export type TabDescriptor = {
  id: TabId;
  label: string;
  /** 右上角的小標記：數字或需要注意的紅點 */
  badge?: { kind: "count" | "attention"; value?: number };
};

type Props = {
  tabs: TabDescriptor[];
  active: TabId;
  onChange: (tab: TabId) => void;
};

export default function TabBar({ tabs, active, onChange }: Props) {
  return (
    // 貼在頂端，滑到頁面深處也能換頁
    <div className="sticky top-0 z-20 -mx-3 mb-4 bg-paper/85 px-3 pt-2 pb-3 backdrop-blur sm:-mx-4 sm:px-4">
      <div
        role="tablist"
        aria-label="主要分頁"
        className="flex gap-1 rounded-2xl border border-line bg-card p-1 shadow-soft"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => onChange(tab.id)}
              className={`relative flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-clay text-white"
                  : "text-ink-muted hover:bg-paper-deep hover:text-ink-soft"
              }`}
            >
              {tab.label}
              {tab.badge?.kind === "count" && tab.badge.value ? (
                <span
                  className={`ml-1 text-xs font-normal ${
                    isActive ? "text-white/75" : "text-ink-muted"
                  }`}
                >
                  {tab.badge.value}
                </span>
              ) : null}
              {tab.badge?.kind === "attention" && !isActive && (
                <span
                  aria-hidden
                  className="absolute top-1.5 right-2 size-1.5 rounded-full bg-clay"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

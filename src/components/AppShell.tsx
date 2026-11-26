import type { ReactNode } from "react";
import { tools, type ToolDefinition } from "@/tools/registry";

type Props = {
  activeId: string;
  onSelect: (id: string) => void;
  children: ReactNode;
};

export function AppShell({ activeId, onSelect, children }: Props) {
  const active = tools.find((t) => t.id === activeId) ?? tools[0];

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="brand">
          <div className="brand__mark" aria-hidden />
          <div>
            <div className="brand__name">Video Tools</div>
            <div className="brand__sub">本地工具套件</div>
          </div>
        </div>

        <nav className="nav" aria-label="工具列表">
          {tools.map((tool) => (
            <ToolNavItem
              key={tool.id}
              tool={tool}
              active={tool.id === active.id}
              onSelect={onSelect}
            />
          ))}
        </nav>

        <div className="shell__footer">后续工具可在侧栏继续扩展</div>
      </aside>

      <main className="shell__main">
        <header className="tool-header">
          <h1>{active.name}</h1>
          <p>{active.description}</p>
        </header>
        <div className="tool-body">{children}</div>
      </main>
    </div>
  );
}

function ToolNavItem({
  tool,
  active,
  onSelect,
}: {
  tool: ToolDefinition;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`nav__item ${active ? "is-active" : ""}`}
      onClick={() => onSelect(tool.id)}
    >
      <span className="nav__dot" aria-hidden />
      <span>
        <span className="nav__title">{tool.name}</span>
        <span className="nav__desc">{tool.shortLabel}</span>
      </span>
    </button>
  );
}

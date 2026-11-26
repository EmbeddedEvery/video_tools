import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { tools } from "@/tools/registry";

export default function App() {
  const [activeId, setActiveId] = useState(tools[0]?.id ?? "video-dedup");
  const active = tools.find((t) => t.id === activeId) ?? tools[0];
  const Tool = active.Component;

  return (
    <AppShell activeId={active.id} onSelect={setActiveId}>
      <Tool />
    </AppShell>
  );
}

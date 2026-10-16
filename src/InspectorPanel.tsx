import type { ReactNode } from 'react';
import { SidebarPanel } from '@weasel-js/ui/components/SidebarPanel';
import { usePersistedFlag } from './usePersistedFlag';

/** A collapsible sidebar section whose folded state survives a reload. */
export function InspectorPanel({ id, title, defaultCollapsed = false, children }: {
  /** Storage key suffix; stable across renames of the title. */
  id: string;
  title: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = usePersistedFlag(`lbx-editor.panel.${id}.collapsed`, defaultCollapsed);
  return (
    <SidebarPanel
      title={title}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(!collapsed)}
      className="inspector-panel"
    >
      {children}
    </SidebarPanel>
  );
}

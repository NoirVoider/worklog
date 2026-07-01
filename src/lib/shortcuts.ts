type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
};

export function isSettingsShortcut(event: ShortcutEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key === ",";
}

export function isToggleSidebarShortcut(event: ShortcutEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b";
}

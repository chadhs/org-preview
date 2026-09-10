export function tabLabel(tab, tabs) {
  const peers = tabs.filter((other) => other.id !== tab.id && other.name === tab.name);
  if (!peers.length) return tab.name;
  const parts = tab.path.split('/').filter(Boolean);
  for (let count = 2; count <= parts.length; count++) {
    const label = parts.slice(-count).join('/');
    if (peers.every((other) => other.path.split('/').filter(Boolean).slice(-count).join('/') !== label)) return label;
  }
  return tab.path;
}

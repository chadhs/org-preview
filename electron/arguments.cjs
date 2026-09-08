const { fileURLToPath } = require('node:url');

// Keep unsupported paths so the reader can explain why they cannot be opened.
function documentArgument(argv, packaged) {
  const args = argv.slice(1);
  if (!packaged) {
    // Electron can move Chromium flags before the app path in second-instance argv.
    const appIndex = args.findIndex((arg) => !arg.startsWith('-'));
    if (appIndex !== -1) args.splice(appIndex, 1);
  }
  const separator = args.indexOf('--');
  const argument = separator !== -1 ? args[separator + 1] : args.find((arg) => !arg.startsWith('-'));
  // Linux desktop entries use %U, which can provide local file URLs.
  if (argument?.startsWith('file:')) {
    try { return fileURLToPath(argument); } catch { /* Let normal file validation report invalid input. */ }
  }
  return argument;
}
module.exports = { documentArgument };

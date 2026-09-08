// Keep unsupported paths so the reader can explain why they cannot be opened.
function documentArgument(argv, packaged) {
  const args = argv.slice(packaged ? 1 : 2);
  const separator = args.indexOf('--');
  if (separator !== -1) return args[separator + 1];
  return args.find((arg) => !arg.startsWith('-'));
}
module.exports = { documentArgument };

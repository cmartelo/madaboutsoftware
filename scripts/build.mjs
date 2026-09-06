// Some Vinext versions force process.exit(0) while native Vite handles are closing.
// On Windows, let Node drain those handles naturally after a successful build.
// Failed builds retain the CLI's original nonzero exit behavior.
if (process.platform === 'win32') {
  const exit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 0) {
      process.exitCode = 0;
      return;
    }
    return exit(code);
  };
}

process.argv = [process.argv[0], 'vinext', 'build', ...process.argv.slice(2)];
await import(
  new URL('../node_modules/vinext/dist/cli.js', import.meta.url).href
);

export function parseArgs(argv: string[]): { name: string } {
  return { name: argv[0] ?? 'world' };
}

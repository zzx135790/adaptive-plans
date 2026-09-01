import fs from 'node:fs';

/** Read startup-buffered stdin reliably when the host supplies a socket-backed fd. */
export async function readStdin() {
  const input = fs.createReadStream(null, { fd: process.stdin.fd, autoClose: false });
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function writeStdout(value) {
  fs.writeSync(process.stdout.fd, String(value));
}

export function writeStderr(value) {
  fs.writeSync(process.stderr.fd, String(value));
}

export function writeJson(value, spacing = 2) {
  writeStdout(`${JSON.stringify(value, null, spacing)}\n`);
}

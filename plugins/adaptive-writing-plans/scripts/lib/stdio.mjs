import fs from 'node:fs';

/** Consume startup-buffered input before falling back to Node's nonblocking stream. */
export function listenStdin(onData, { onEnd = () => {}, onError = () => {} } = {}) {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const waitForManagedStdin = () => {
    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
  };
  const read = () => {
    fs.read(0, buffer, 0, buffer.length, null, (error, bytesRead) => {
      if (error?.code === 'EAGAIN') {
        waitForManagedStdin();
        return;
      }
      if (error) {
        onError(error);
        return;
      }
      if (bytesRead === 0) {
        onEnd();
        return;
      }
      onData(Buffer.from(buffer.subarray(0, bytesRead)));
      read();
    });
  };
  read();
}

/** Read all stdin as UTF-8. */
export async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    listenStdin(
      (chunk) => chunks.push(chunk),
      { onEnd: () => resolve(Buffer.concat(chunks).toString('utf8')), onError: reject },
    );
  });
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

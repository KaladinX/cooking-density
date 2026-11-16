// Stream the rows of a CSV file inside a zip without unpacking it:
// `unzip -p archive member` piped into a small RFC 4180 state machine.
import { spawn } from 'node:child_process';

/** Calls onRow(array) for every row, header included. Resolves when the file ends. */
export function streamZipCsv(zipPath, member, onRow) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', zipPath, member], { stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.setEncoding('utf8');
    let row = [];
    let field = '';
    let quoted = false;
    let pendingQuote = false; // saw a quote while quoted; next char decides
    child.stdout.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (pendingQuote) {
          pendingQuote = false;
          if (c === '"') { field += '"'; continue; }
          quoted = false;
        }
        if (quoted) {
          if (c === '"') pendingQuote = true;
          else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); onRow(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`unzip exited ${code}`));
      if (field !== '' || row.length) { row.push(field); onRow(row); }
      resolve();
    });
  });
}

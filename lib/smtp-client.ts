import tls from 'node:tls';

type SmtpOptions = {
  host?: string;
  port?: number;
  username: string;
  password: string;
  timeoutMs?: number;
};

type SendOptions = SmtpOptions & {
  from: string;
  to: string;
  raw: string;
};

class SmtpSession {
  socket: tls.TLSSocket;
  buffer = '';
  pending: Array<{ resolve: (value: { code: number; text: string }) => void; reject: (error: Error) => void }> = [];

  constructor(socket: tls.TLSSocket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.onData(String(chunk || '')));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed.')));
  }

  onData(chunk: string) {
    this.buffer += chunk;
    while (true) {
      const parsed = parseResponse(this.buffer);
      if (!parsed) return;
      this.buffer = parsed.rest;
      const waiter = this.pending.shift();
      if (waiter) waiter.resolve({ code: parsed.code, text: parsed.text });
    }
  }

  fail(error: Error) {
    while (this.pending.length) this.pending.shift()?.reject(error);
  }

  response() {
    return new Promise<{ code: number; text: string }>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  async command(command: string, expected: number | number[]) {
    const wait = this.response();
    this.socket.write(command + '\r\n');
    const result = await wait;
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(result.code)) throw smtpError(result.code, result.text);
    return result;
  }
}

function parseResponse(buffer: string) {
  const lines = buffer.split(/\r?\n/);
  if (lines.length < 2) return null;
  const first = lines[0];
  const match = first.match(/^(\d{3})([ -])(.*)$/);
  if (!match) {
    const idx = buffer.search(/\r?\n/);
    if (idx < 0) return null;
    return { code: 0, text: buffer.slice(0, idx), rest: buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1)) };
  }
  const code = Number(match[1]);
  if (match[2] === ' ') {
    const consumed = first.length + (buffer.startsWith(first + '\r\n') ? 2 : 1);
    return { code, text: match[3], rest: buffer.slice(consumed) };
  }
  let consumedChars = 0;
  const collected: string[] = [];
  for (const line of lines) {
    if (!line) {
      consumedChars += 2;
      continue;
    }
    const row = line.match(/^(\d{3})([ -])(.*)$/);
    const ending = buffer.slice(consumedChars + line.length, consumedChars + line.length + 2) === '\r\n' ? 2 : 1;
    consumedChars += line.length + ending;
    collected.push(row?.[3] || line);
    if (row && Number(row[1]) === code && row[2] === ' ') {
      return { code, text: collected.join(' | '), rest: buffer.slice(consumedChars) };
    }
  }
  return null;
}

function smtpError(code: number, text: string) {
  const message = 'SMTP ' + code + ': ' + text;
  const lower = String(text || '').toLowerCase();
  const error = new Error(message) as Error & { status?: number; limitHit?: boolean; blocked?: boolean };
  error.status = code;
  error.limitHit =
    code === 421 ||
    code === 450 ||
    code === 451 ||
    code === 452 ||
    lower.includes('daily') ||
    lower.includes('quota') ||
    lower.includes('rate') ||
    lower.includes('limit');
  error.blocked =
    code === 550 ||
    code === 551 ||
    code === 552 ||
    code === 553 ||
    code === 554 ||
    lower.includes('blocked') ||
    lower.includes('spam') ||
    lower.includes('policy') ||
    lower.includes('rejected');
  return error;
}

function normalizeRaw(raw: string) {
  return String(raw || '')
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => line.startsWith('.') ? '.' + line : line)
    .join('\r\n');
}

async function connect(options: SmtpOptions) {
  const host = String(options.host || 'smtp.gmail.com');
  const port = Number(options.port || 465);
  const timeoutMs = Math.max(5000, Math.min(Number(options.timeoutMs || 15000), 30000));
  if (port !== 465) throw new Error('Scout currently supports implicit TLS SMTP on port 465. Use smtp.gmail.com:465 for Gmail App Passwords.');

  const socket = tls.connect({
    host,
    port,
    servername: host,
    rejectUnauthorized: true,
  });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP connection timed out.')));

  const session = new SmtpSession(socket);
  const greeting = await session.response();
  if (greeting.code !== 220) throw new Error('SMTP greeting failed: ' + greeting.text);
  await session.command('EHLO scout-app', 250);
  await session.command('AUTH LOGIN', 334);
  await session.command(Buffer.from(options.username, 'utf8').toString('base64'), 334);
  await session.command(Buffer.from(options.password, 'utf8').toString('base64'), 235);
  return session;
}

export async function testSmtpConnection(options: SmtpOptions) {
  const session = await connect(options);
  try {
    await session.command('NOOP', 250);
    await session.command('QUIT', 221).catch(() => null);
    return { ok: true };
  } finally {
    session.socket.end();
  }
}

export async function sendRawSmtp(options: SendOptions) {
  const session = await connect(options);
  try {
    await session.command('MAIL FROM:<' + options.from + '>', 250);
    await session.command('RCPT TO:<' + options.to + '>', [250, 251]);
    await session.command('DATA', 354);
    const wait = session.response();
    session.socket.write(normalizeRaw(options.raw) + '\r\n.\r\n');
    const result = await wait;
    if (result.code !== 250) throw smtpError(result.code, result.text);
    await session.command('QUIT', 221).catch(() => null);
    return { id: '', threadId: '', response: result.text };
  } finally {
    session.socket.end();
  }
}

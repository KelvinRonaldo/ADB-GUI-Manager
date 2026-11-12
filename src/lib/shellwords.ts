/** Divide uma linha de comando como um shell faria: aspas simples, duplas e barra invertida. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (quote) throw new Error('UNCLOSED_QUOTE');
  if (has) out.push(cur);
  return out;
}

/** Tira o "adb" do começo, se a pessoa colou o comando inteiro. */
export function stripAdb(args: string[]): string[] {
  if (args.length && /(^|[\\/])adb(\.exe)?$/i.test(args[0])) return args.slice(1);
  return args;
}

/** Como o argumento aparece para copiar (mesma regra do registro, no Rust). */
export function quoteArg(a: string): string {
  if (a !== '' && /^[A-Za-z0-9/._\-+=:@%,[\]]+$/.test(a)) return a;
  return '"' + a.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function displayCommand(args: string[]): string {
  return ['adb', ...args.map(quoteArg)].join(' ');
}

/** Aspas para o shell do aparelho (o adb junta os argumentos de `shell` numa linha). */
export function shQuote(s: string): string {
  if (s !== '' && /^[A-Za-z0-9/._\-+=:@%,]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

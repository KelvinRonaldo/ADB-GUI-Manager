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

/**
 * Abre um app pelo monkey tentando as categorias de abertura em ordem: LAUNCHER (app comum),
 * LEANBACK_LAUNCHER (TV) e HOME (app que é a tela inicial, como os builds "launcher").
 * O monkey de Android antigo sai com 0 mesmo sem achar atividade, por isso a saída é conferida.
 */
export function openAppScript(pkg: string): string {
  const q = shQuote(pkg);
  return (
    `for c in LAUNCHER LEANBACK_LAUNCHER HOME; do ` +
    `o=$(monkey -p ${q} -c android.intent.category.$c 1 2>&1); ` +
    `case "$o" in *"No activities found"*|*"monkey aborted"*) ;; *) echo "category=$c"; exit 0;; esac; ` +
    `done; echo "ADBGUI_NO_ACTIVITY"; exit 1`
  );
}

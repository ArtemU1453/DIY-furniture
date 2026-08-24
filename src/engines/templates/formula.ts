/**
 * FormulaEngine — безопасный вычислитель параметрических выражений.
 *
 * Формулы вида `width - 2 * thickness`, `max(a, b)`, `(h - t) / (n + 1)`.
 * Реализация БЕЗ eval: токенизация → сортировочная станция (shunting-yard) →
 * обратная польская запись → вычисление. Детерминирована и тестируема.
 *
 * Поддержка: числа, переменные, + - * / %, унарный минус, скобки,
 * функции min/max/round/floor/ceil/abs.
 */

export type FormulaScope = Record<string, number>;

export class FormulaError extends Error {}

type Token =
  | { t: 'num'; v: number }
  | { t: 'var'; v: string }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'comma' }
  | { t: 'lp' }
  | { t: 'rp' };

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: (a) => Math.round(a[0]),
  floor: (a) => Math.floor(a[0]),
  ceil: (a) => Math.ceil(a[0]),
  abs: (a) => Math.abs(a[0]),
};

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, 'u-': 3 };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isAlpha = (c: string) => /[A-Za-z_]/.test(c);
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(expr[i + 1] ?? ''))) {
      let j = i;
      while (j < expr.length && (isDigit(expr[j]) || expr[j] === '.')) j++;
      const num = Number(expr.slice(i, j));
      if (!Number.isFinite(num)) throw new FormulaError(`Некорректное число: ${expr.slice(i, j)}`);
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < expr.length && (isAlpha(expr[j]) || isDigit(expr[j]) || expr[j] === '.')) j++;
      const name = expr.slice(i, j);
      // Функция, если следом «(».
      let k = j;
      while (k < expr.length && expr[k] === ' ') k++;
      if (expr[k] === '(') tokens.push({ t: 'fn', v: name });
      else tokens.push({ t: 'var', v: name });
      i = j;
      continue;
    }
    if ('+-*/%'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(') { tokens.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'comma' }); i++; continue; }
    throw new FormulaError(`Недопустимый символ: «${c}»`);
  }
  return tokens;
}

/** Преобразовать в ОПЗ (обратную польскую запись). */
function toRpn(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const stack: Token[] = [];
  let prev: Token | undefined;
  for (const tok of tokens) {
    if (tok.t === 'num' || tok.t === 'var') {
      out.push(tok);
    } else if (tok.t === 'fn') {
      stack.push(tok);
    } else if (tok.t === 'comma') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop()!);
      if (!stack.length) throw new FormulaError('Неверная запятая в формуле');
    } else if (tok.t === 'op') {
      // Унарный минус: в начале или после оператора/скобки/запятой.
      const unary = tok.v === '-' && (!prev || prev.t === 'op' || prev.t === 'lp' || prev.t === 'comma');
      const opName = unary ? 'u-' : tok.v;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const topName = top.t === 'op' ? top.v : top.t === 'fn' ? 'fn' : undefined;
        if (top.t === 'fn') { out.push(stack.pop()!); continue; }
        if (topName && PRECEDENCE[topName] !== undefined && PRECEDENCE[topName] >= PRECEDENCE[opName]) {
          out.push(stack.pop()!);
        } else break;
      }
      stack.push({ t: 'op', v: opName });
    } else if (tok.t === 'lp') {
      stack.push(tok);
    } else if (tok.t === 'rp') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop()!);
      if (!stack.length) throw new FormulaError('Несбалансированные скобки');
      stack.pop(); // убрать lp
      if (stack.length && stack[stack.length - 1].t === 'fn') out.push(stack.pop()!);
    }
    prev = tok;
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === 'lp') throw new FormulaError('Несбалансированные скобки');
    out.push(top);
  }
  return out;
}

function evalRpn(rpn: Token[], scope: FormulaScope): number {
  const st: number[] = [];
  for (const tok of rpn) {
    if (tok.t === 'num') st.push(tok.v);
    else if (tok.t === 'var') {
      const v = scope[tok.v];
      if (v === undefined || !Number.isFinite(v)) throw new FormulaError(`Неизвестная переменная: ${tok.v}`);
      st.push(v);
    } else if (tok.t === 'op') {
      if (tok.v === 'u-') { const a = st.pop(); if (a === undefined) throw new FormulaError('Ошибка выражения'); st.push(-a); continue; }
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new FormulaError('Ошибка выражения');
      switch (tok.v) {
        case '+': st.push(a + b); break;
        case '-': st.push(a - b); break;
        case '*': st.push(a * b); break;
        case '/': st.push(b === 0 ? 0 : a / b); break;
        case '%': st.push(b === 0 ? 0 : a % b); break;
        default: throw new FormulaError(`Неизвестный оператор: ${tok.v}`);
      }
    } else if (tok.t === 'fn') {
      const fn = FUNCTIONS[tok.v];
      if (!fn) throw new FormulaError(`Неизвестная функция: ${tok.v}`);
      // Функции min/max могут иметь ≥2 аргументов; берём все со стека до маркера
      // невозможно — вместо этого функции с фиксированной арностью 1, кроме
      // min/max (2). Упрощение: min/max берут 2 верхних значения.
      if (tok.v === 'min' || tok.v === 'max') {
        const b = st.pop();
        const a = st.pop();
        if (a === undefined || b === undefined) throw new FormulaError(`Функция ${tok.v} требует 2 аргумента`);
        st.push(fn([a, b]));
      } else {
        const a = st.pop();
        if (a === undefined) throw new FormulaError(`Функция ${tok.v} требует аргумент`);
        st.push(fn([a]));
      }
    }
  }
  if (st.length !== 1) throw new FormulaError('Некорректное выражение');
  return st[0];
}

/** Вычислить выражение по области переменных. Бросает FormulaError при ошибке. */
export function evaluateFormula(expr: string, scope: FormulaScope): number {
  const tokens = tokenize(expr);
  const rpn = toRpn(tokens);
  return evalRpn(rpn, scope);
}

/** Список переменных, от которых зависит выражение. */
export function formulaVariables(expr: string): string[] {
  const vars = new Set<string>();
  for (const tok of tokenize(expr)) {
    if (tok.t === 'var') vars.add(tok.v);
  }
  return [...vars];
}

/**
 * Обнаружить циклические зависимости в наборе именованных формул.
 * Возвращает цикл (список имён) или null, если циклов нет.
 */
export function detectCircular(formulas: Record<string, string>): string[] | null {
  const deps = new Map<string, string[]>();
  for (const [name, expr] of Object.entries(formulas)) {
    deps.set(name, formulaVariables(expr).filter((v) => v in formulas));
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of deps.get(node) ?? []) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        // Найден цикл — возвращаем его срез.
        const start = stack.indexOf(dep);
        return stack.slice(start).concat(dep);
      }
      if (c === WHITE) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }
    }
    color.set(node, BLACK);
    stack.pop();
    return null;
  }

  for (const name of deps.keys()) {
    if ((color.get(name) ?? WHITE) === WHITE) {
      const cycle = dfs(name);
      if (cycle) return cycle;
    }
  }
  return null;
}

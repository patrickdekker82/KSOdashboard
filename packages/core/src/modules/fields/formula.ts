/**
 * Formulevelden (hoofdstuk 3.2).
 *
 * Een formule rekent over de velden van hetzelfde record. Er komt geen `eval`
 * aan te pas en er is geen toegang tot iets buiten de meegegeven waarden: de
 * uitdrukking wordt ontleed tot een boom en die boom wordt gelopen. Wat er niet
 * in de grammatica staat, kan een formule niet doen.
 *
 * Ondersteund: getallen, teksten, veldverwijzingen, + - * / %, vergelijkingen,
 * EN/OF/NIET, haakjes, en een handvol functies met Nederlandse namen.
 */

export class FormuleFout extends Error {
  readonly positie: number;

  constructor(message: string, positie = 0) {
    super(message);
    this.name = 'FormuleFout';
    this.positie = positie;
  }
}

export type FormulaValue = number | string | boolean | null;
export type FormulaContext = Record<string, FormulaValue>;

// ---------------------------------------------------------------------------
// Ontleden
// ---------------------------------------------------------------------------

type TokenType = 'getal' | 'tekst' | 'naam' | 'operator' | 'haakje' | 'komma' | 'einde';
type Token = { type: TokenType; waarde: string; positie: number };

const OPERATORS = [
  '<=', '>=', '<>', '!=', '==', '&&', '||',
  '+', '-', '*', '/', '%', '<', '>', '=', '!',
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'haakje', waarde: char, positie: i });
      i += 1;
      continue;
    }

    if (char === ',' || char === ';') {
      tokens.push({ type: 'komma', waarde: ',', positie: i });
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let waarde = '';
      i += 1;
      while (i < input.length && input[i] !== quote) {
        // Een backslash laat het volgende teken letterlijk door.
        if (input[i] === '\\' && i + 1 < input.length) i += 1;
        waarde += input[i];
        i += 1;
      }
      if (i >= input.length) throw new FormuleFout('Een aanhalingsteken is niet gesloten.', i);
      i += 1;
      tokens.push({ type: 'tekst', waarde, positie: i });
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let waarde = '';
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        waarde += input[i];
        i += 1;
      }
      if ((waarde.match(/\./g) ?? []).length > 1) {
        throw new FormuleFout(`"${waarde}" is geen geldig getal.`, i);
      }
      tokens.push({ type: 'getal', waarde, positie: i });
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let waarde = '';
      while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i]!)) {
        waarde += input[i];
        i += 1;
      }
      tokens.push({ type: 'naam', waarde, positie: i });
      continue;
    }

    const operator = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (operator) {
      tokens.push({ type: 'operator', waarde: operator, positie: i });
      i += operator.length;
      continue;
    }

    throw new FormuleFout(`Onbekend teken "${char}" in de formule.`, i);
  }

  tokens.push({ type: 'einde', waarde: '', positie: input.length });
  return tokens;
}

type Node =
  | { soort: 'getal'; waarde: number }
  | { soort: 'tekst'; waarde: string }
  | { soort: 'constante'; waarde: FormulaValue }
  | { soort: 'veld'; naam: string }
  | { soort: 'unair'; operator: string; kind: Node }
  | { soort: 'binair'; operator: string; links: Node; rechts: Node }
  | { soort: 'functie'; naam: string; argumenten: Node[] };

/**
 * Bindingssterkte; hoger bindt strakker.
 *
 * Alle opzoektabellen hier zijn een Map en geen object-literal. Een literal
 * erft van Object.prototype, en dan levert een opzoeking op "constructor",
 * "__proto__" of "valueOf" een functie op in plaats van niets — waarmee die
 * functie zo een formule in lekt. Een Map kent alleen wat erin gezet is.
 */
const PRECEDENCE = new Map<string, number>([
  ['||', 1],
  ['&&', 2],
  ['=', 3], ['==', 3], ['<>', 3], ['!=', 3],
  ['<', 4], ['<=', 4], ['>', 4], ['>=', 4],
  ['+', 5], ['-', 5],
  ['*', 6], ['/', 6], ['%', 6],
]);

const CONSTANTEN = new Map<string, FormulaValue>([
  ['waar', true],
  ['onwaar', false],
  ['true', true],
  ['false', false],
  ['leeg', null],
  ['null', null],
]);

const MAX_NEST_DIEPTE = 64;

class Parser {
  private index = 0;
  private diepte = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  parse(): Node {
    const node = this.parseExpression(0);
    if (this.peek().type !== 'einde') {
      throw new FormuleFout(`Onverwacht "${this.peek().waarde}" in de formule.`, this.peek().positie);
    }
    return node;
  }

  private parseExpression(minPrecedence: number): Node {
    // De parser roept zichzelf aan per haakjespaar; zonder grens legt een
    // formule van duizend haakjes de stack om.
    if (this.diepte >= MAX_NEST_DIEPTE) {
      throw new FormuleFout('De formule is te diep genest.', this.peek().positie);
    }
    this.diepte += 1;
    try {
      return this.parseExpressionInner(minPrecedence);
    } finally {
      this.diepte -= 1;
    }
  }

  private parseExpressionInner(minPrecedence: number): Node {
    let links = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (token.type !== 'operator') break;
      const precedence = PRECEDENCE.get(token.waarde);
      if (precedence === undefined || precedence < minPrecedence) break;
      this.next();
      // Alles is links-associatief, dus rechts bindt één niveau strakker.
      const rechts = this.parseExpression(precedence + 1);
      links = { soort: 'binair', operator: token.waarde, links, rechts };
    }

    return links;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token.type === 'operator' && (token.waarde === '-' || token.waarde === '!')) {
      this.next();
      return { soort: 'unair', operator: token.waarde, kind: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.next();

    if (token.type === 'getal') return { soort: 'getal', waarde: Number(token.waarde) };
    if (token.type === 'tekst') return { soort: 'tekst', waarde: token.waarde };

    if (token.type === 'haakje' && token.waarde === '(') {
      const node = this.parseExpression(0);
      const sluit = this.next();
      if (sluit.type !== 'haakje' || sluit.waarde !== ')') {
        throw new FormuleFout('Er ontbreekt een sluithaakje.', sluit.positie);
      }
      return node;
    }

    if (token.type === 'naam') {
      const sleutel = token.waarde.toLowerCase();
      if (CONSTANTEN.has(sleutel)) {
        return { soort: 'constante', waarde: CONSTANTEN.get(sleutel)! };
      }

      // Een naam met haakje erachter is een functieaanroep.
      if (this.peek().type === 'haakje' && this.peek().waarde === '(') {
        this.next();
        const argumenten: Node[] = [];
        if (!(this.peek().type === 'haakje' && this.peek().waarde === ')')) {
          for (;;) {
            argumenten.push(this.parseExpression(0));
            if (this.peek().type === 'komma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const sluit = this.next();
        if (sluit.type !== 'haakje' || sluit.waarde !== ')') {
          throw new FormuleFout(
            `Er ontbreekt een sluithaakje na ${token.waarde}.`,
            sluit.positie,
          );
        }
        return { soort: 'functie', naam: token.waarde.toUpperCase(), argumenten };
      }

      return { soort: 'veld', naam: token.waarde };
    }

    throw new FormuleFout(
      token.type === 'einde'
        ? 'De formule is niet af.'
        : `Onverwacht "${token.waarde}" in de formule.`,
      token.positie,
    );
  }
}

/** Ontleedt een formule. Gooit een `FormuleFout` met uitleg als dat niet lukt. */
export function parseFormula(expression: string): Node {
  if (expression.trim() === '') throw new FormuleFout('De formule is leeg.');
  if (expression.length > 2000) throw new FormuleFout('De formule is te lang (maximaal 2000 tekens).');
  return new Parser(tokenize(expression)).parse();
}

// ---------------------------------------------------------------------------
// Uitrekenen
// ---------------------------------------------------------------------------

function toNumber(value: FormulaValue): number {
  if (value === null || value === '') return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const getal = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(getal)) throw new FormuleFout(`"${String(value)}" is geen getal.`);
  return getal;
}

function toText(value: FormulaValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'waar' : 'onwaar';
  return String(value);
}

function toBoolean(value: FormulaValue): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value !== '';
}

type FunctieHandler = (argumenten: FormulaValue[]) => FormulaValue;

/** Alleen wat hier staat, kan een formule aanroepen. */
const FUNCTIE_TABEL: Record<string, FunctieHandler> = {
  ALS: (args) => {
    if (args.length < 2) throw new FormuleFout('ALS verwacht minstens een voorwaarde en een waarde.');
    return toBoolean(args[0]!) ? args[1]! : (args[2] ?? null);
  },
  ROND: (args) => {
    const decimalen = args.length > 1 ? Math.trunc(toNumber(args[1]!)) : 0;
    const factor = 10 ** Math.min(Math.max(decimalen, 0), 10);
    return Math.round(toNumber(args[0] ?? 0) * factor) / factor;
  },
  AFRONDEN_BENEDEN: (args) => Math.floor(toNumber(args[0] ?? 0)),
  AFRONDEN_BOVEN: (args) => Math.ceil(toNumber(args[0] ?? 0)),
  ABS: (args) => Math.abs(toNumber(args[0] ?? 0)),
  MIN: (args) => Math.min(...args.map(toNumber)),
  MAX: (args) => Math.max(...args.map(toNumber)),
  SOM: (args) => args.reduce((total: number, value) => total + toNumber(value), 0),
  GEMIDDELDE: (args) =>
    args.length === 0 ? 0 : args.reduce((t: number, v) => t + toNumber(v), 0) / args.length,
  LENGTE: (args) => toText(args[0] ?? null).length,
  SAMENVOEGEN: (args) => args.map(toText).join(''),
  HOOFDLETTERS: (args) => toText(args[0] ?? null).toUpperCase(),
  KLEINELETTERS: (args) => toText(args[0] ?? null).toLowerCase(),
  IS_LEEG: (args) => args[0] === null || args[0] === undefined || args[0] === '',
  // Engelse namen als alias, want de code eromheen is Engels.
  IF: (args) => FUNCTIE_TABEL.ALS!(args),
  ROUND: (args) => FUNCTIE_TABEL.ROND!(args),
  SUM: (args) => FUNCTIE_TABEL.SOM!(args),
  LEN: (args) => FUNCTIE_TABEL.LENGTE!(args),
  CONCAT: (args) => FUNCTIE_TABEL.SAMENVOEGEN!(args),
};

const FUNCTIES = new Map<string, FunctieHandler>(Object.entries(FUNCTIE_TABEL));

export const BESCHIKBARE_FUNCTIES = [...FUNCTIES.keys()].sort();

function evaluateNode(node: Node, context: FormulaContext, diepte: number): FormulaValue {
  // Een formule mag niet oneindig diep zijn; de parser laat dat theoretisch toe.
  if (diepte > 64) throw new FormuleFout('De formule is te diep genest.');

  switch (node.soort) {
    case 'getal':
      return node.waarde;
    case 'tekst':
      return node.waarde;
    case 'constante':
      return node.waarde;
    case 'veld': {
      // Bewust Object.hasOwn en niet `in`: `in` loopt de prototypeketen af,
      // waardoor "constructor" en "toString" een treffer geven op
      // Object.prototype en er een functie uit de formule zou lekken.
      if (!Object.hasOwn(context, node.naam)) {
        throw new FormuleFout(`Het veld "${node.naam}" bestaat niet in dit record.`);
      }
      return context[node.naam] ?? null;
    }
    case 'unair': {
      const waarde = evaluateNode(node.kind, context, diepte + 1);
      return node.operator === '-' ? -toNumber(waarde) : !toBoolean(waarde);
    }
    case 'binair': {
      const links = evaluateNode(node.links, context, diepte + 1);

      // EN en OF rekenen alleen de rechterkant uit als dat nodig is.
      if (node.operator === '&&') {
        return toBoolean(links) ? toBoolean(evaluateNode(node.rechts, context, diepte + 1)) : false;
      }
      if (node.operator === '||') {
        return toBoolean(links) ? true : toBoolean(evaluateNode(node.rechts, context, diepte + 1));
      }

      const rechts = evaluateNode(node.rechts, context, diepte + 1);

      switch (node.operator) {
        case '+':
          // Plus telt getallen op, maar plakt teksten aan elkaar.
          return typeof links === 'string' || typeof rechts === 'string'
            ? toText(links) + toText(rechts)
            : toNumber(links) + toNumber(rechts);
        case '-':
          return toNumber(links) - toNumber(rechts);
        case '*':
          return toNumber(links) * toNumber(rechts);
        case '/': {
          const deler = toNumber(rechts);
          // Delen door nul geeft leeg in plaats van Infinity, zodat een
          // formule op een half ingevuld record geen onzin toont.
          return deler === 0 ? null : toNumber(links) / deler;
        }
        case '%': {
          const deler = toNumber(rechts);
          return deler === 0 ? null : toNumber(links) % deler;
        }
        case '=':
        case '==':
          return gelijk(links, rechts);
        case '<>':
        case '!=':
          return !gelijk(links, rechts);
        case '<':
          return vergelijk(links, rechts) < 0;
        case '<=':
          return vergelijk(links, rechts) <= 0;
        case '>':
          return vergelijk(links, rechts) > 0;
        case '>=':
          return vergelijk(links, rechts) >= 0;
        default:
          throw new FormuleFout(`Onbekende operator "${node.operator}".`);
      }
    }
    case 'functie': {
      const handler = FUNCTIES.get(node.naam);
      if (!handler) {
        throw new FormuleFout(
          `De functie ${node.naam} bestaat niet. Beschikbaar: ${BESCHIKBARE_FUNCTIES.join(', ')}.`,
        );
      }
      // ALS mag geen argumenten uitrekenen die het niet nodig heeft.
      if (node.naam === 'ALS' || node.naam === 'IF') {
        const voorwaarde = toBoolean(evaluateNode(node.argumenten[0]!, context, diepte + 1));
        const tak = voorwaarde ? node.argumenten[1] : node.argumenten[2];
        return tak ? evaluateNode(tak, context, diepte + 1) : null;
      }
      return handler(node.argumenten.map((argument) => evaluateNode(argument, context, diepte + 1)));
    }
  }
}

function gelijk(a: FormulaValue, b: FormulaValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'string' || typeof b === 'string') return toText(a) === toText(b);
  return toNumber(a) === toNumber(b);
}

function vergelijk(a: FormulaValue, b: FormulaValue): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const links = toNumber(a);
  const rechts = toNumber(b);
  return links < rechts ? -1 : links > rechts ? 1 : 0;
}

/** Rekent een formule uit over de velden van één record. */
export function evaluateFormula(expression: string, context: FormulaContext): FormulaValue {
  return evaluateNode(parseFormula(expression), context, 0);
}

/**
 * Controleert een formule zonder hem uit te rekenen.
 *
 * Naast het ontleden wordt gecontroleerd of elke aangeroepen functie bestaat.
 * Zonder die controle zou een typefout als STIEKEM(1) gewoon opgeslagen worden
 * en pas opvallen wanneer er een record mee wordt gelezen — precies waar de
 * beheerder er niets meer aan kan doen.
 *
 * Geeft de veldnamen terug die erin voorkomen, zodat de beheerder ziet waar de
 * formule van afhangt.
 */
export function checkFormula(
  expression: string,
): { ok: true; velden: string[] } | { ok: false; fout: string } {
  try {
    const node = parseFormula(expression);
    const velden = new Set<string>();
    const onbekend = new Set<string>();

    const loop = (huidig: Node): void => {
      switch (huidig.soort) {
        case 'veld':
          velden.add(huidig.naam);
          break;
        case 'unair':
          loop(huidig.kind);
          break;
        case 'binair':
          loop(huidig.links);
          loop(huidig.rechts);
          break;
        case 'functie':
          if (!FUNCTIES.has(huidig.naam)) onbekend.add(huidig.naam);
          huidig.argumenten.forEach(loop);
          break;
        default:
          break;
      }
    };
    loop(node);

    if (onbekend.size > 0) {
      const namen = [...onbekend].join(', ');
      return {
        ok: false,
        fout:
          `De functie ${namen} bestaat niet. ` +
          `Beschikbaar: ${BESCHIKBARE_FUNCTIES.join(', ')}.`,
      };
    }

    return { ok: true, velden: [...velden].sort() };
  } catch (error) {
    return { ok: false, fout: error instanceof Error ? error.message : String(error) };
  }
}

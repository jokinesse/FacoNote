/**
 * Math expression evaluator for workshop dimensions.
 * Evaluates inputs like "2*1+2*2", "1200+850", "3*2.5 + 4*1.2", "4*(2+1)"
 * Safely parses and calculates without using unrestricted `eval`.
 */

export function evaluateExpression(expr: string): number {
  if (!expr || typeof expr !== 'string') return NaN;

  // Replace commas with dots
  let clean = expr.replace(/,/g, '.').trim();

  // Validate only allowed characters: digits, decimal points, + - * / ( ) and spaces
  if (!/^[0-9+\-*/().\s]+$/.test(clean)) {
    return NaN;
  }

  // Tokenize
  const tokens: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const char = clean[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '(' || char === ')') {
      tokens.push(char);
      i++;
    } else if (/[0-9.]/.test(char)) {
      let numStr = '';
      while (i < clean.length && /[0-9.]/.test(clean[i])) {
        numStr += clean[i];
        i++;
      }
      tokens.push(numStr);
    } else {
      return NaN;
    }
  }

  if (tokens.length === 0) return NaN;

  // Shunting-yard algorithm to RPN
  const outputQueue: (number | string)[] = [];
  const opStack: string[] = [];

  const precedence: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
  };

  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    const num = Number(token);

    if (!isNaN(num) && token !== '') {
      outputQueue.push(num);
    } else if (token === '(') {
      opStack.push(token);
    } else if (token === ')') {
      while (opStack.length > 0 && opStack[opStack.length - 1] !== '(') {
        outputQueue.push(opStack.pop()!);
      }
      if (opStack.length === 0) return NaN; // Mismatched parentheses
      opStack.pop(); // Pop '('
    } else if (precedence[token]) {
      // Handle unary minus: if at start or right after an operator or '('
      const prev = tokens[j - 1];
      if (token === '-' && (j === 0 || prev === '(' || precedence[prev])) {
        // Unary minus: push a 0 before it
        outputQueue.push(0);
      }
      while (
        opStack.length > 0 &&
        opStack[opStack.length - 1] !== '(' &&
        precedence[opStack[opStack.length - 1]] >= precedence[token]
      ) {
        outputQueue.push(opStack.pop()!);
      }
      opStack.push(token);
    } else {
      return NaN;
    }
  }

  while (opStack.length > 0) {
    const op = opStack.pop()!;
    if (op === '(' || op === ')') return NaN;
    outputQueue.push(op);
  }

  // Evaluate RPN
  const evalStack: number[] = [];
  for (const item of outputQueue) {
    if (typeof item === 'number') {
      evalStack.push(item);
    } else {
      const b = evalStack.pop();
      const a = evalStack.pop();
      if (a === undefined || b === undefined) return NaN;
      switch (item) {
        case '+':
          evalStack.push(a + b);
          break;
        case '-':
          evalStack.push(a - b);
          break;
        case '*':
          evalStack.push(a * b);
          break;
        case '/':
          if (b === 0) return NaN;
          evalStack.push(a / b);
          break;
        default:
          return NaN;
      }
    }
  }

  if (evalStack.length !== 1) return NaN;
  const result = evalStack[0];
  // Round to 4 decimal places for floating point precision
  return Math.round(result * 10000) / 10000;
}

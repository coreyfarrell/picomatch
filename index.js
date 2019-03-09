'use strict';

const path = require('path');
const win32 = process.platform === 'win32';

/**
 * Constants
 */

const NO_DOT = '(?!\\.)';
const ONE_CHAR = '(?=.)';

const QMARK = '[^/]';
const QMARK_NO_DOT = '[^/.]';
const QMARK_WINDOWS = '[^\\\\/]';
const QMARK_WINDOWS_NO_DOT = '[^\\\\/.]';
const QMARK_LITERAL = '\\?';

const SLASH_LITERAL = '\\/';
const SLASH_LITERAL_WINDOWS = '[\\\\/]';
const DOT_LITERAL = '\\.';

const STAR = `${QMARK}*?`;
const STAR_PLUS = `${QMARK}+?`;
const STAR_WINDOWS = `${QMARK_WINDOWS}*?`;
const STAR_PLUS_WINDOWS = `${QMARK_WINDOWS}+?`;

const GLOBSTAR_NO_DOTS = '(?:\\.{1,2})($|\\/)';
const GLOBSTAR_NO_DOT = '\\.';

/**
 * Helpers
 */

const trimStart = str => str.startsWith('./') ? str.slice(2) : str;
const globstar = dot => {
  return `(?:(?!(?:\\/|^)${dot ? GLOBSTAR_NO_DOTS : GLOBSTAR_NO_DOT}).)*?`;
};

const syntaxError = (place, char) => {
  return `Missing ${place}: "${char}" - use "\\\\${char}" to match literal characters`;
};

const picomatch = (pattern, options) => {
  let regex = picomatch.makeRe(pattern, options);
  let isWindows = win32 === true || path.sep === '\\' || (options && options.windows === true);
  console.log(regex, options);

  return str => {
    if (options && options.unixify === true || isWindows) {
      str = str.replace(/\\/g, '/');
    }

      console.log([str])
    return regex.test(str);
  }
};

const fastpaths = (input, options) => {
  let opts = options || {};
  let isWindows = win32 === true || path.sep === '\\' || opts.windows === true;
  let dot = opts.dot ? '' : NO_DOT;
  let starPlus = isWindows ? STAR_PLUS_WINDOWS : STAR_PLUS;
  let star = isWindows ? STAR_WINDOWS : STAR;

  switch (input) {
    case '*':
    case '***':
      if (opts.flags || opts.dot) {
        return new RegExp(`^(?:${dot}${starPlus})$`, opts.flags);
      }
      return isWindows ? /^(?:(?!\.)[^\\/]+?)$/ : /^(?:(?!\.)[^/]+?)$/;

    case '*/*':
      if (opts.flags || opts.dot) {
        return new RegExp(`^(?:${dot}${starPlus}\\/${dot}${starPlus})$`, opts.flags);
      }
      return isWindows
        ? /^(?:(?!\.)[^\\/]+?[\\/](?!\.)[^\\/]+?)$/
        : /^(?:(?!\.)[^/]+?\/(?!\.)[^/]+?)$/;

    case '**':
    case '**/**':
    case '**/**/**':
      if (opts.flags) {
        return new RegExp(`^(?:${globstar(false)})$`, opts.flags);
      }
      return isWindows
        ? /^(?:(?!(?:[\\/]|^)(?:\.{1,2})($|[\\/])).)*?$/
        : /^(?:(?!(?:\/|^)(?:\.{1,2})($|\/)).)*?$/;

    default: {
      let match = /^(.*?)(?:\.(\w+))$/.exec(input);
      if (!match) return;

      let regex = fastpaths(match[1], options);
      if (!regex) return;

      let source = regex.source.slice(4, -3) + DOT_LITERAL + match[2];
      return new RegExp(`(?:${source})$`, opts.flags);
    }
  }
};

picomatch.parse = (input, options) => {
  let opts = options || { dot: false };
  let bos = { type: 'bos', value: '' };
  let tokens = [bos];

  let isWindows = win32 || path.sep === '\\' || opts.windows === true;
  let state = {
    consumed: '',
    output: '',
    backtracked: false,
    brackets: 0,
    braces: 0,
    parens: 0,
    tokens,
  };

  let len = input.length;
  let i = -1;
  let lastSlash;
  let prev = bos;
  let last;
  let next;
  let value;
  let token;

  const eos = () => i === len - 1;
  const peek = (n = 1) => input[i + n];
  const advance = () => input[++i];

  const append = token => {
    state.output += token.output || token.value;
    state.consumed += token.value || '';
  };

  const push = token => {
    if (prev.type === 'globstar') {
      if (token.type !== 'slash' && token.type !== 'paren' && token.type !== 'brace') {
        state.backtracked = true;
        tokens[tokens.length - 1] = {
          type: 'star',
          value: '*',
          output: isWindows ? STAR_WINDOWS : STAR
        };
      }
    }

    if (token.value || token.output) append(token);
    if (token.type === 'slash') lastSlash = token;

    if (last && last.type === 'text' && token.type === 'text') {
      last.value += token.value;
      prev = last;
      return;
    }

    tokens.push(token);
    prev = token;
  };

  // parse input
  while (!eos()) {
    value = advance();
    last = prev;

    if (value === '\\') {
      if (opts.unescape === true) {
        value = advance() || '';
      } else if (isWindows && !/\W/.test(peek())) {
        value += '\\';
      } else {
        value += advance() || '';
      }

      if (!state.brackets) {
        push({ type: 'text', value });
        continue;
      }
    }

    if (state.brackets > 0 && value !== ']') {
      prev.value += value;
      append({ value });
      continue;
    }

    if (value === '(') {
      push({ type: 'paren', value });
      state.parens++;
      continue;
    }

    if (value === ')') {
      if (options.strictBrackets === true) {
        throw new SyntaxError(syntaxError('opening', '('));
      }
      push({ type: 'paren', value, output: state.parens ? ')' : '\\)' });
      state.parens--;
      continue;
    }

    if (value === '[') {
      push({ type: 'bracket', value });
      state.brackets++;
      continue;
    }

    if (value === ']') {
      if (options.strictBrackets === true) {
        throw new SyntaxError(syntaxError('opening', '['));
      }
      prev.value += value;
      append({ value });
      state.brackets--;
      continue;
    }

    if (value === '{' && opts.nobrace !== true) {
      push({ type: 'brace', value, output: '(' });
      state.braces++;
      continue;
    }

    if (value === '}' && opts.nobrace !== true) {
      push({ type: 'brace', value, output: state.braces ? ')' : '\\}' });
      state.braces--;
      continue;
    }

    if (value === ',') {
      push({ type: 'comma', value, output: state.braces ? '|' : value });
      continue;
    }

    if (value === '/') {
      if (prev.type === 'dot' && i === 1) {
        state.consumed = '';
        state.output = '';
        tokens.pop();
        continue;
      }

      if (prev.type === 'globstar' && prev.prior) {
        prev.prior.output = '(?:' + prev.prior.output;
        prev.output += ')?';
      }

      push({ type: 'slash', value, output: isWindows ? SLASH_LITERAL_WINDOWS : SLASH_LITERAL });
      continue;
    }

    if (value === '.') {
      push({ type: 'dot', value, output: DOT_LITERAL });
      continue;
    }

    if (value === '?') {
      if (last && last.type === 'paren') {
        if (peek() === '<' && parseInt(process.version.slice(1), 10) < 10) {
          throw new Error('Node.js v10 or higher is required for regex lookbehinds');
        }
        push({ type: 'text', value });
        continue;
      }

      if (opts.qmarkLiteral === true) {
        push({ type: 'qmark', value, output: QMARK_LITERAL });
        continue;
      }

      if (prev.type === 'slash' || prev.type === 'bos') {
        push({ type: 'qmark', value, output: QMARK_NO_DOT });
        continue;
      }

      push({ type: 'qmark', value, output: isWindows ? QMARK_WINDOWS : QMARK });
      continue;
    }

    if (value === '!') {
      if (i === 0) {
        state.negated = true;
        continue;
      }
    }

    if (value !== '*') {
      if (value === '$' || value === '^') {
        value = '\\' + value;
      }

      push({ type: 'text', value });
      continue;
    }

    if (prev && (prev.type === 'globstar' || prev.star === true)) {
      prev.type = 'star';
      prev.star = true;
      prev.value += value;
      prev.output = isWindows ? STAR_WINDOWS : STAR;
      state.backtracked = true;
      state.consumed += value;
      continue;
    }

    if (prev.type === 'star') {
      let ends = ['slash', 'paren', 'brace'];
      let prior = false;

      for (let n = tokens.length - 2; n > 0; n--) {
        let tok = tokens[n];

        if (tok.type === 'onechar' || tok.type === 'nodot') {
          tok.output = '';
          continue;
        }

        prior = tok;
        break;
      }

      if (prior && prior.type !== 'slash' && prior.type !== 'paren' && prior.type !== 'brace') {
        continue;
      }

      if (prior && prior.type === 'slash') {
        prev.prior = prior;
      }

      prev.type = 'globstar';
      prev.output = globstar(opts.dot);
      prev.value += value;

      state.backtracked = true;
      state.consumed += value;
      continue;
    }

    let token = { type: 'star', value, output: isWindows ? STAR_WINDOWS : STAR };
    if (i === 0 || (prev.type === 'slash')) {
      let nodot = { type: 'nodot', value: '', output: NO_DOT };
      let onchar = { type: 'onechar', value: '', output: ONE_CHAR };

      // add references to the "star" token, so we can avoid backtracking later
      token.nodot = nodot;
      token.onchar = onchar;

      push(nodot);
      push(onchar);
    }

    push(token);
  }

  // rebuild the output if we had to backtrack at any point
  if (state.backtracked === true) {
    state.output = '';

    for (let token of state.tokens) {
      state.output += (token.output || token.value);
    }
  }

  // console.log(state);
  return state;
};

picomatch.isMatch = (str, pattern, options) => picomatch(pattern, options)(str);

picomatch.makeRe = (pattern, options) => {
  if (!pattern || typeof pattern !== 'string') return /$^/;
  let opts = options || { dot: false };

  let regex = fastpaths(pattern, opts);
  if (regex) {
    return regex;
  }

  let state = picomatch.parse(pattern, opts);
  let output = state.output;

  let flags = opts.flags || (opts.nocase ? 'i' : '');
  let prefix = opts.contains ? '' : '^';
  let suffix = opts.contains ? '' : '$';
  let source = prefix + '(?:' + output + ')' + suffix;

  if (state.negated === true) {
    // source = `(?:(?!^${source}$).*)`;
    source = `^(?!${source}).*$`;
  }

  try {
    return new RegExp(source, flags);
  } catch (err) {
    return new RegExp(source.replace(/\W/g, '\\$&'), flags);
  }
};

picomatch.precompile = (method, pattern, options, fn) => {
  let nocache = picomatch.nocache === true || options && options.nocache === true;
  if (nocache) {
    return fn(pattern, options);
  }

  if (picomatch.cache === void 0) {
    picomatch.cache = {};
  }

  let memoKey = picomatch.createKey(method, pattern, options);
  let result = picomatch.cache[memoKey];

  if (result === void 0) {
    result = picomatch.cache[memoKey] = fn(pattern, options);
  }

  return result;
};

picomatch.createKey = (method, pattern, options) => {
  let memoKey = `method="${method}";pattern="${pattern}"`;
  if (!options) return memoKey;

  let optionString = '';
  for (let key of Object.keys(options)) {
    optionString += `${key}:${options[key]};`;
  }

  if (optionString) {
    memoKey += `;options=${optionString}`;
  }
  return memoKey;
};

/**
 * Clear the picomatch cache that is used for precompiled regular expressions.
 * Precompiling can be completely disabled by setting `nocache` to true.
 *
 * ```js
 * picomatch.clearCache();
 * ```
 * @return {Object} Returns the `picomatch.cache`.
 * @api public
 */

picomatch.clearCache = () => (picomatch.cache = {});

/**
 * Initialize the nocache property
 */

picomatch.nocache = process.env.PICOMATCH_NO_CACHE === 'true';
module.exports = picomatch;

// const mm = require('minimatch');

// console.log(mm.makeRe('c/*3.txt'));
// console.log(mm.makeRe('*'));
// console.log('---');
// console.log(picomatch.makeRe('*.txt'));
// console.log(picomatch.makeRe('*'));

// let state = picomatch.parse('a/**{/,}');
// console.log(state);

// const foo = /^(?:(?=.)[^/]*?)$/;
// const bar = /^(?:[^/]+?)$/;

// console.log([foo.test('/abc/'), bar.test('/abc/')]);
// console.log([foo.test('abc/'), bar.test('abc/')]);
// console.log([foo.test('/abc'), bar.test('/abc')]);
// console.log([foo.test('abc'), bar.test('abc')]);
// console.log([foo.test('/'), bar.test('/')]);
// console.log([foo.test(''), bar.test('')]);


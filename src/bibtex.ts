import type { StreamParser } from "@codemirror/language";

// BibTeX/BibLaTeX data and common .bst tokens; highlighting only.
export const bibtex: StreamParser<{ depth: number; quoted: boolean }> = {
  startState: () => ({ depth: 0, quoted: false }),
  token(stream, state) {
    if (state.quoted) {
      while (!stream.eol()) {
        const c = stream.next();
        if (c === "\\") stream.next();
        else if (c === '"') {
          state.quoted = false;
          break;
        }
      }
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^%.*$/)) return "comment";
    if (stream.match(/^@[a-zA-Z]+/)) return "keyword";
    if (stream.match(/^[a-zA-Z][\w-]*(?=\s*=)/)) return "attributeName";
    if (stream.match(/^[a-zA-Z][\w:./-]*(?=\s*,)/)) return "definition";
    if (
      stream.match(
        /^(?:ENTRY|FUNCTION|INTEGERS|STRINGS|MACRO|READ|EXECUTE|ITERATE|REVERSE|SORT)\b/,
      )
    )
      return "keyword";
    if (stream.match(/^#?-?\d+/)) return "number";
    const c = stream.next();
    if (c === '"') {
      state.quoted = true;
      return "string";
    }
    if (c === "{") {
      state.depth++;
      return "brace";
    }
    if (c === "}") {
      state.depth = Math.max(0, state.depth - 1);
      return "brace";
    }
    if (c === "\\") {
      stream.eatWhile(/[a-zA-Z]/);
      return "keyword";
    }
    if (c && "=,#".includes(c)) return "operator";
    stream.eatWhile(/[^{}"\\%=,#\s]/);
    return state.depth > 1 ? "string" : null;
  },
  languageData: { commentTokens: { line: "%" } },
};

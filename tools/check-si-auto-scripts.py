#!/usr/bin/env python3
"""Allow-list checker for the si-auto hook scripts. Used by tools/check-si-auto.sh.

Bash: every script is lexed as bash (quotes, $(...), <(...), $((...)), heredocs),
split into simple commands, and each command must be on the allow-list with its
allowed arguments. Writes (redirections, mv, rm, mkdir, find -delete) must match
an exact shape under $D. Protected variables can only take their exact values.
Python: the helper is checked on its AST (imports, calls, writes).

  usage: check-si-auto-scripts.py <scripts-dir>
Prints one error per line; exit status 1 if any.
"""
import ast
import re
import sys
from pathlib import Path

ERRORS = []


def err(where, msg):
    ERRORS.append(f"{where}: {msg}")


# --- Bash lexer ---------------------------------------------------------------

OPS = ("&&", "||", ";", "|", "&", "(", ")", "{", "}", "\n")


class Lexer:
    """Turns bash source into tokens. Nested $(...) / <(...) bodies are queued as
    separate sources so their commands are checked too."""

    def __init__(self, src, where):
        self.s, self.i, self.where = src, 0, where
        self.tokens, self.nested, self.heredocs = [], [], []

    def peek(self, k=0):
        j = self.i + k
        return self.s[j] if j < len(self.s) else ""

    def balanced(self, open_ch="(", close_ch=")"):
        """Read from just after an opening paren to its match; return the body."""
        depth, start, quote = 1, self.i, None
        while self.i < len(self.s):
            c = self.s[self.i]
            if quote:
                if c == "\\" and quote == '"':
                    self.i += 1
                elif c == quote:
                    quote = None
            elif c in "'\"":
                quote = c
            elif c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    body = self.s[start:self.i]
                    self.i += 1
                    return body
            self.i += 1
        err(self.where, "unbalanced parentheses")
        return self.s[start:]

    def dollar(self):
        """At '$': consume a parameter, $(...), $((...)) or $'...' and return its text."""
        self.i += 1
        if self.peek() == "(" and self.peek(1) == "(":
            self.i += 2
            body = self.balanced()
            if self.peek() == ")":
                self.i += 1
            if "$(" in body or "`" in body:
                err(self.where, "command substitution inside $((...)) is not allowed")
            return "$((" + body + "))"
        if self.peek() == "(":
            self.i += 1
            body = self.balanced()
            self.nested.append(body)
            return "$(" + body + ")"
        if self.peek() == "{":
            self.i += 1
            return "${" + self.balanced("{", "}") + "}"
        if self.peek() == "'":
            # $'...' (ANSI-C quoting): \' does not close the string.
            j = self.i + 1
            while j < len(self.s) and self.s[j] != "'":
                j += 2 if self.s[j] == "\\" else 1
            if j >= len(self.s):
                err(self.where, "unterminated $'...' string")
            text = self.s[self.i - 1:j + 1]
            self.i = j + 1
            return text
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*|[0-9$#?@*!-]", self.s[self.i:])
        name = m.group(0) if m else ""
        self.i += len(name)
        return "$" + name

    def double_quoted(self):
        out = ['"']
        self.i += 1
        while self.i < len(self.s) and self.s[self.i] != '"':
            c = self.s[self.i]
            if c == "\\":
                out.append(self.s[self.i:self.i + 2])
                self.i += 2
            elif c == "$":
                out.append(self.dollar())
            elif c == "`":
                err(self.where, "backticks are not allowed")
                self.i += 1
            else:
                out.append(c)
                self.i += 1
        self.i += 1
        out.append('"')
        return "".join(out)

    def run(self):
        word = []

        def flush():
            if word:
                self.tokens.append(("W", "".join(word)))
                word.clear()

        while self.i < len(self.s):
            c = self.s[self.i]
            if c == "\n":
                flush()
                self.tokens.append(("O", "\n"))
                self.i += 1
                for tag in self.heredocs:          # skip quoted heredoc bodies
                    end = re.compile(rf"^{re.escape(tag)}$", re.M).search(self.s, self.i)
                    if not end:
                        err(self.where, f"heredoc {tag} never ends")
                        self.i = len(self.s)
                    else:
                        self.i = end.end()
                self.heredocs.clear()
            elif c in " \t":
                flush()
                self.i += 1
            elif c == "\\" and self.peek(1) == "\n":
                self.i += 2
            elif c == "#" and not word:
                while self.i < len(self.s) and self.s[self.i] != "\n":
                    self.i += 1
            elif c == "'":
                j = self.s.index("'", self.i + 1)
                word.append(self.s[self.i:j + 1])
                self.i = j + 1
            elif c == '"':
                word.append(self.double_quoted())
            elif c == "$":
                word.append(self.dollar())
            elif c == "`":
                err(self.where, "backticks are not allowed")
                self.i += 1
            elif c in "<>" and self.peek(1) == "(":
                flush()
                self.i += 2
                self.nested.append(self.balanced())
                self.tokens.append(("W", "$P"))
            elif c in "<>" or (c == "&" and self.peek(1) == ">") or (c.isdigit() and not word and self.peek(1) in "<>"):
                fd = ""
                if c.isdigit():
                    fd, self.i = c, self.i + 1
                m = re.match(r"<<<|<<-?|>>|>&|<&|&>>?|>\||[<>]", self.s[self.i:])
                op = m.group(0)
                self.i += len(op)
                flush()
                while self.peek() in " \t":
                    self.i += 1
                if op.startswith("<<") and op != "<<<":
                    t = re.match(r"'([A-Za-z_]+)'", self.s[self.i:])
                    if not t:
                        err(self.where, "only quoted heredocs (<<'TAG') are allowed")
                        t = re.match(r"\S+", self.s[self.i:])
                        self.heredocs.append(t.group(0).strip("\"'"))
                    else:
                        self.heredocs.append(t.group(1))
                    self.i += len(t.group(0))
                    continue
                self.tokens.append(("R", fd + op))
            elif self.s.startswith(("&&", "||"), self.i):
                flush()
                self.tokens.append(("O", self.s[self.i:self.i + 2]))
                self.i += 2
            elif c in ";|&(){}" and not (c in "{}" and word):
                flush()
                self.tokens.append(("O", c))
                self.i += 1
            else:
                word.append(c)
                self.i += 1
        flush()
        return self.tokens


# --- Bash rules ---------------------------------------------------------------

KEYWORDS = {"if", "then", "elif", "else", "fi", "while", "until", "do", "done", "!"}
# The only functions, all defined once in comun.sh. Scripts cannot add their own.
FUNCTIONS = {"py", "campo", "bitacora", "leer_meta", "leer_num", "poner_meta", "borrar_meta", "ahora",
             "umbral_del_contrato", "preparar_repo", "iniciar_gancho"}
# Shapes that write through "$1" are only allowed inside these two helpers.
DOLLAR1_FUNCS = {"poner_meta", "borrar_meta"}
DOLLAR1_SHAPES = {'mv "$1.tmp.$$" "$1"'}
DEFINED = set()
SIMPLE = {"echo", "cat", "tail", "tr", "ls", "basename", "dirname", "date", "ps", "grep",
          "true", ":", "[", "[[", "cd", "pwd", "continue", "break", "exit", "return", "local"}
# Exact shapes for commands that write, and for the few commands with fixed arguments.
EXACT = {
    "mv": {'mv "$1.tmp.$$" "$1"', 'mv "$D/$SESION.md.tmp" "$D/$SESION.md"',
           'mv "$m" "$D/entregadas/$id.meta"', 'mv "$D/$id.md" "$D/entregadas/$id.md"'},
    "rm": {'rm -f "$D/falta-python3"', 'rm -f "$D/entregadas/$id.meta"'},
    "mkdir": {'mkdir -p "$D/entregadas"'},
    "find": {'find "$D/entregadas" -type f -mtime +14 -delete'},
    "python3": {'python3 "$AQUI/leer-json.py" "$@"'},
    ".": {'. "$(dirname "$0")/comun.sh"'},
    "set": {"set -u"},
    "command": {"command -v python3"},
    "kill": {'kill -0 "$otro"'},
    "read": {"read -r id valor", "read -r m"},
}
REDIRECT_TARGETS = {'"$D/bitacora.log"', '"$D/$SESION.md.tmp"', '"$1.tmp.$$"',
                    '"$D/falta-python3"', "/dev/null", "&1", "&2"}
PROTECTED = {
    "D": {'""', '"$comun/si-auto"'},
    "SESION": {'""', '"$(campo session_id)"'},
    "AQUI": {'"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"'},
    "ENTRADA": {'""', '"$(cat)"'},
    "META": {'"$D/$SESION.meta"'},
    "m": {'"${n%.md}.meta"', '"$D/entregadas/$id.meta"'},
    "id": {'"$(basename "$m" .meta)"'},
    "comun": {'"$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"',
              '"$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"'},
    "IFS": {"", "$'\\t'"},
}
# The .meta files the write helpers may touch ($1 inside them is checked as a redirect target).
META_FILES = {'"$META"', '"$m"', '"$D/entregadas/$id.meta"'}
OWN_UPPER = {"UMBRAL_MIN", "ENTRADA", "SESION", "D", "META", "AQUI", "IFS"}
SED_PROGRAM = re.compile(r"""^["'](s/\^[A-Za-z_$0-9]+=//p)["']$""")
AWK_FORBIDDEN = re.compile(r"system|getline|close|fflush|ENVIRON|[|>]")


def check_command(where, words, redirs, func=None):
    # Leading assignments (VAR=value cmd ...). Protected names only take exact values;
    # upper-case names (environment: PATH, GIT_DIR, BASH_ENV...) only the plugin's own.
    while words and re.match(r"^[A-Za-z_][A-Za-z0-9_]*\+?=", words[0]):
        name, value = words[0].split("=", 1)
        name = name.rstrip("+")
        if name in PROTECTED and value not in PROTECTED[name]:
            err(where, f"{name} may not be set to {value}")
        if re.match(r"^[A-Z_][A-Z0-9_]*$", name) and name not in OWN_UPPER:
            err(where, f"setting {name} is not allowed")
        words = words[1:]
    if not words:
        return
    cmd, line = words[0], " ".join(words + redirs)
    plain = " ".join(words)
    if cmd in ("printf",) and len(words) > 1 and words[1] == "-v":
        err(where, "printf -v is not allowed")
    elif cmd == "printf":
        pass
    elif cmd in ("poner_meta", "borrar_meta"):
        if len(words) < 2 or words[1] not in META_FILES:
            err(where, f"{cmd} may only write the .meta files under $D: {plain}")
    elif cmd in SIMPLE or cmd in FUNCTIONS:
        if cmd == "local" and not all(re.match(r"^[a-z_][a-z0-9_]*$", w) for w in words[1:]):
            err(where, "local may only declare lower-case names")
    elif cmd == "git":
        if len(words) < 4 or words[1] != "-C" or words[3] != "rev-parse":
            err(where, f"git may only be called as git -C <dir> rev-parse: {plain}")
    elif cmd == "sed":
        if len(words) != 4 or words[1] != "-n" or not SED_PROGRAM.match(words[2]):
            err(where, f"sed may only print a key=value field: {plain}")
    elif cmd == "awk":
        if AWK_FORBIDDEN.search(words[1] if len(words) > 1 else ""):
            err(where, "awk program may not write, run commands or read other input")
    elif cmd in EXACT:
        if plain in DOLLAR1_SHAPES and func not in DOLLAR1_FUNCS:
            err(where, f"{plain} is only allowed inside poner_meta/borrar_meta")
        elif plain not in EXACT[cmd]:
            err(where, f"{cmd} is only allowed as one of its exact shapes: {plain}")
    elif re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", cmd) and cmd.endswith("()"):
        pass
    else:
        err(where, f"command not allowed: {cmd}")
    if cmd == "read":
        for name in words[2:]:
            if name in PROTECTED and name not in ("id", "m"):
                err(where, f"read may not set {name}")


def check_bash(path):
    where = path.name
    sources = [(path.read_text(encoding="utf-8"), None)]
    while sources:
        src, outer = sources.pop()
        lexer = Lexer(src, where)
        tokens = lexer.run()
        words, redirs = [], []
        expect_target, func, depth, pending = None, outer, 0, None
        for kind, val in tokens + [("O", "\n")]:
            if expect_target:
                if val == '"$1.tmp.$$"' and func not in DOLLAR1_FUNCS:
                    err(where, "writes through $1 are only allowed inside poner_meta/borrar_meta")
                if expect_target.endswith(">&"):
                    if val not in ("1", "2"):
                        err(where, f"fd duplication to {val} is not allowed")
                elif ">" in expect_target and val not in REDIRECT_TARGETS:
                    err(where, f"write to {val} is not allowed (only under $D)")
                redirs.append(f"{expect_target}{val}")
                expect_target = None
                continue
            if kind == "R":
                expect_target = val
            elif kind == "W":
                # Function definition "name()" arrives as word + "(" + ")": skip it.
                words.append(val)
            else:
                if val == "(" and words and len(words) == 1 and re.match(r"^[A-Za-z_]\w*$", words[0]):
                    name = words[0]
                    if where != "comun.sh" or name not in FUNCTIONS or name in DEFINED:
                        err(where, f"defining function {name} is not allowed")
                    DEFINED.add(name)
                    pending, words = name, []
                    continue
                if val == ")" and not words:
                    continue
                if val == "{":
                    if pending:
                        func, pending, depth = pending, None, 0
                    elif func and func != outer:
                        depth += 1
                if val == "}" and func and func != outer:
                    if depth == 0:
                        check_command(where, words, redirs, func)
                        words, redirs, func = [], [], outer
                        continue
                    depth -= 1
                while words and words[0] in KEYWORDS:
                    words = words[1:]
                if words and words[0] in ("for", "case", "function", "select"):
                    if words[0] != "for":
                        err(where, f"{words[0]} is not allowed")
                    words = []
                check_command(where, words, redirs, func)
                words, redirs = [], []
        sources.extend((body, func) for body in lexer.nested)


# --- Python rules -------------------------------------------------------------

PY_IMPORTS = {"json", "re", "sys", "datetime"}
PY_BANNED = {"exec", "eval", "compile", "__import__", "getattr", "setattr", "globals",
             "locals", "vars", "input", "breakpoint", "memoryview", "os", "pathlib",
             "subprocess", "socket", "shutil", "importlib"}
PY_BANNED_ATTR = {"write", "writelines", "write_text", "write_bytes", "system", "popen",
                  "unlink", "rename", "replace_file", "mkdir", "rmdir", "modules", "open",
                  "system", "spawn", "fork", "load_module"}


def check_python(path):
    where = path.name
    tree = ast.parse(path.read_text(encoding="utf-8"))
    calls = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [(node.module or "").split(".")[0]]
        else:
            names = []
        for n in names:
            if n not in PY_IMPORTS:
                err(where, f"import not allowed: {n}")
        if isinstance(node, ast.Name) and (node.id in PY_BANNED or (node.id.startswith("__") and node.id not in ("__name__", "__doc__"))):
            err(where, f"name not allowed: {node.id}")
        if isinstance(node, ast.Attribute) and (node.attr in PY_BANNED_ATTR or node.attr.startswith("__")):
            err(where, f"attribute not allowed: {node.attr}")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "open":
            calls.add(id(node.func))
            if any(isinstance(a, ast.Starred) for a in node.args) or any(k.arg is None for k in node.keywords):
                err(where, "open() may not take *args or **kwargs")
            mode = node.args[1] if len(node.args) > 1 else next(
                (k.value for k in node.keywords if k.arg == "mode"), None)
            if mode is not None and not (isinstance(mode, ast.Constant) and mode.value in ("r", "rt")):
                err(where, "open() may only read")
    # open may only appear as the function of a direct call, never stored or passed around.
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == "open" and id(node) not in calls:
            err(where, "open may only be called directly")


def main():
    d = Path(sys.argv[1])
    for p in sorted(d.glob("*.sh")):
        check_bash(p)
    for p in sorted(d.glob("*.py")):
        check_python(p)
    print("\n".join(ERRORS))
    sys.exit(1 if ERRORS else 0)


if __name__ == "__main__":
    main()

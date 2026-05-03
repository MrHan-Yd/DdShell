import type { Terminal } from "@xterm/xterm";

/**
 * 从 xterm 终端缓冲区反向扫描，启发式地推断当前 shell 的工作目录（cwd）。
 *
 * 不依赖远程 shell 配置，不污染 PTY；准确性是「尽力而为」，找不到就返回 null。
 * 调用方应在 null 时降级到文件选择器并要求用户确认。
 *
 * 推断优先级（高到低）：
 *   1. 提示符里包含 cwd（PS1 含 `\w`）—— 最可信
 *   2. 最近一条 `cd /xxx` 命令
 *   3. 最近一条 `ls/ll/cat/less/more` 等命令的目录参数
 *
 * 限制：
 *   - 只识别绝对路径（"/" 开头），不展开 `~`、`$VAR` 或 `$(...)`
 *   - 不跟踪 `cd ..`、`pushd/popd`、ssh 嵌套、子 shell
 *   - 不验证目标目录是否真的存在（由调用方在 sftpListDir 失败时降级处理）
 */
export function inferCwdFromBuffer(term: Terminal, scanLines = 30): string | null {
  const buffer = term.buffer.active;
  if (buffer.length === 0) return null;

  const lines: string[] = [];
  const start = Math.max(0, buffer.length - scanLines);
  // 从底向上收集（lines[0] 最新）
  for (let i = buffer.length - 1; i >= start; i--) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (text.length > 0) lines.push(text);
  }
  if (lines.length === 0) return null;

  // 1. 提示符里 cwd — 形如：user@host:/etc/nginx$  或  [user@host nginx]#
  //    只取行尾的 :path<sp>?<#$> 模式
  const promptCwdRe = /:(\/[^\s:]*)\s*[#$]\s*$/;
  for (const line of lines) {
    const m = line.match(promptCwdRe);
    if (m && m[1]) return m[1];
  }

  const tracked = inferCwdFromCommandLines(lines.slice().reverse());
  if (tracked) return tracked;

  // 2. 最近一条 cd 命令 — 仅识别绝对路径形式 `cd /xxx`
  //    左边界要么是行首（用户从头敲），要么是提示符末尾（[#$] + 空白）
  const cdRe = /(?:^|[#$]\s+)cd\s+(\/[^\s;|&<>]+)/;
  for (const line of lines) {
    const m = line.match(cdRe);
    if (m && m[1]) return m[1];
  }

  // 3. 最近一条文件浏览类命令的绝对路径参数
  //    `ls /etc/nginx`、`ll -la /var/log`、`cat /etc/hosts`
  //    若参数明显是文件（包含 . 且不以 / 结尾），取其父目录；目录直接返回。
  const browseRe = /(?:^|[#$]\s+)(?:ls|ll|la|cat|less|more|head|tail)\s+(?:-[a-zA-Z]+\s+)*(\/[^\s;|&<>]+)/;
  for (const line of lines) {
    const m = line.match(browseRe);
    if (m && m[1]) {
      const arg = m[1];
      // 启发：包含 "." 且最后一段像文件名 → 取父目录
      const lastSeg = arg.split("/").pop() ?? "";
      if (lastSeg.includes(".") && !arg.endsWith("/")) {
        return getParentDir(arg);
      }
      // 否则认为是目录路径（移除尾部 /）
      return arg.length > 1 && arg.endsWith("/") ? arg.slice(0, -1) : arg;
    }
  }

  return null;
}

function normalizeAbsPath(path: string): string {
  const trailing = path.endsWith("/") && path !== "/";
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = "/" + parts.join("/");
  return trailing && normalized !== "/" ? `${normalized}/` : normalized;
}

function resolvePathArg(current: string | null, arg: string): string | null {
  if (!arg || arg.startsWith("~") || arg.startsWith("$")) return null;
  const cleaned = arg.replace(/\\ /g, " ").replace(/\/+$/g, "");
  if (cleaned.startsWith("/")) return normalizeAbsPath(cleaned);
  if (!current) return null;
  return normalizeAbsPath(`${current}/${cleaned}`);
}

function commandText(line: string): string {
  const promptMatch = line.match(/[#$]\s+(.+)$/);
  return (promptMatch?.[1] ?? line).trim();
}

function firstPathArg(command: string): string | null {
  const parts = command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
  for (const part of parts.slice(1)) {
    if (part.startsWith("-")) continue;
    return part.replace(/^['"]|['"]$/g, "");
  }
  return null;
}

function inferCwdFromCommandLines(linesOldestFirst: string[]): string | null {
  let cwd: string | null = null;
  const stack: string[] = [];
  const promptCwdRe = /:(\/[^\s:]*)\s*[#$]\s*$/;

  for (const line of linesOldestFirst) {
    const prompt = line.match(promptCwdRe);
    if (prompt?.[1]) cwd = normalizeAbsPath(prompt[1]);

    const cmd = commandText(line);
    if (!cmd) continue;

    const name = cmd.split(/\s+/, 1)[0];
    if (name === "cd") {
      const arg = firstPathArg(cmd) ?? "/";
      const next = resolvePathArg(cwd, arg);
      if (next) cwd = next;
    } else if (name === "pushd") {
      const arg = firstPathArg(cmd);
      const next = arg ? resolvePathArg(cwd, arg) : stack[stack.length - 1];
      if (cwd) stack.push(cwd);
      if (next) cwd = next;
    } else if (name === "popd") {
      cwd = stack.pop() ?? cwd;
    }
  }

  return cwd;
}

/**
 * 取一个绝对路径的父目录。`/etc/nginx/nginx.conf` → `/etc/nginx`，`/foo` → `/`。
 */
export function getParentDir(absPath: string): string {
  const parts = absPath.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  parts.pop();
  return "/" + parts.join("/");
}

/**
 * 清洗终端选区文本作为路径候选。返回 null 表示选区不像路径或为空。
 *
 * 规则（按顺序）：
 *   - trim 空白与换行
 *   - 去掉成对外层引号 `"..."` / `'...'`
 *   - `\ ` → ` `（终端常见空格转义）
 *   - 拒绝包含换行 / 多余空白 / 制表符的多 token 选区
 */
export function cleanSelectedPath(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // 去掉成对外层引号
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
    if (!s) return null;
  }

  // \<space> → <space>
  s = s.replace(/\\ /g, " ");

  // 多 token / 含换行：拒绝
  if (/[\r\n\t]/.test(s)) return null;

  return s;
}

export function extractAbsolutePathFromSelection(raw: string): string | null {
  const cleaned = cleanSelectedPath(raw);
  if (cleaned && isAbsolutePath(cleaned)) return cleaned;

  const text = raw.trim();
  if (!text || /[\r\n\t]/.test(text)) return null;

  const matches: string[] = [];
  const tokenRe = /(?:^|\s)(['"]?)(\/(?:\\ |[^\s'";|&<>])+)(\1)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const tokenStart = match.index + (match[0].startsWith(" ") ? 1 : 0);
    const prefix = text.slice(0, tokenStart).trimEnd();
    const before = prefix.charAt(prefix.length - 1);
    if (before === ">" || before === "<") continue;

    const path = match[2]
      .replace(/\\ /g, " ")
      .replace(/[),.:]+$/g, "");
    if (path) matches.push(path);
  }

  return matches.length === 1 ? matches[0] : null;
}

/**
 * 判断清洗后的字符串是否为绝对路径（"/" 开头）。
 */
export function isAbsolutePath(s: string): boolean {
  return s.startsWith("/");
}

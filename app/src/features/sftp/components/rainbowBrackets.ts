import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * 彩虹括号：() [] {} 按嵌套深度循环着色（4 色，来自 --color-syntax-bracket-1..4）。
 * 配对不上的右括号不加装饰（保持 token 原色）——shell `case x)` 等语法里
 * 单侧 ")" 是合法的，标错误样式会造成高频误报；光标处的错配信号由
 * bracketMatching 的 .cm-nonmatchingBracket 提供。
 * 字符串/注释内的括号通过语法树识别并跳过，不参与配对计数——否则注释里的
 * 单个 "(" 会把其后整个文件的深度着色带偏。
 */

/** 超过该字符数停用彩虹括号（quick edit 文件上限 1MB，避免极端文件全量扫描卡输入）。 */
const RAINBOW_MAX_DOC_LENGTH = 200_000;

const BRACKET_COLOR_CYCLE = 4;

/** 命中即整段跳过的语法树节点名（覆盖现代 lang 包与 legacy StreamLanguage 两套命名）。 */
const SKIPPED_NODE_NAME = /comment|string|regexp|propertyname|char/i;

const CLOSE_TO_OPEN: Record<number, number> = {
  0x29: 0x28, // ) → (
  0x5d: 0x5b, // ] → [
  0x7d: 0x7b, // } → {
};

const bracketDecorations = Array.from({ length: BRACKET_COLOR_CYCLE }, (_, index) =>
  Decoration.mark({ class: `qe-bracket-${index + 1}` }),
);

/** 收集需跳过的区间，返回扁平有序数组 [from, to, from, to, ...]。 */
function collectSkippedRanges(state: EditorState): number[] {
  const ranges: number[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (SKIPPED_NODE_NAME.test(node.name)) {
        ranges.push(node.from, node.to);
        return false;
      }
    },
  });
  return ranges;
}

function buildDecorations(state: EditorState): DecorationSet {
  const docLength = state.doc.length;
  if (docLength === 0 || docLength > RAINBOW_MAX_DOC_LENGTH) return Decoration.none;

  const skipped = collectSkippedRanges(state);
  const text = state.doc.sliceString(0);
  const builder = new RangeSetBuilder<Decoration>();
  const stack: number[] = [];
  let skipIndex = 0;

  for (let pos = 0; pos < docLength; pos++) {
    while (skipIndex < skipped.length && skipped[skipIndex + 1] <= pos) skipIndex += 2;
    if (skipIndex < skipped.length && pos >= skipped[skipIndex]) {
      pos = skipped[skipIndex + 1] - 1;
      continue;
    }

    const code = text.charCodeAt(pos);
    if (code === 0x28 || code === 0x5b || code === 0x7b) {
      builder.add(pos, pos + 1, bracketDecorations[stack.length % BRACKET_COLOR_CYCLE]);
      stack.push(code);
    } else if (code === 0x29 || code === 0x5d || code === 0x7d) {
      if (stack.length > 0 && stack[stack.length - 1] === CLOSE_TO_OPEN[code]) {
        stack.pop();
        builder.add(pos, pos + 1, bracketDecorations[stack.length % BRACKET_COLOR_CYCLE]);
      }
      // 配对不上的右括号不装饰：shell `case x)`、正文里的半括号都是合法场景。
    }
  }

  return builder.finish();
}

export const rainbowBrackets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** 语法树引用，identity 变化说明增量解析推进了（如打开大文件时后台补全解析），需重算跳过区间。 */
    private tree: unknown;

    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.decorations = buildDecorations(view.state);
    }

    update(update: ViewUpdate) {
      const tree = syntaxTree(update.state);
      if (update.docChanged || tree !== this.tree) {
        this.tree = tree;
        this.decorations = buildDecorations(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 这次真的把整页搞崩过：在校准面板里加了一个 `useCallback`，
 * 而它写在了组件的 `if (!isOpen) return null` **之后**。
 *
 * 关闭时 41 个 Hook、打开时 42 个，React 抛
 * "Rendered more hooks than during the previous render"，根级 ErrorBoundary 接管，
 * 用户看到的是"豆织星格加载遇到错误"的整页错误卡片。
 *
 * tsc 查不出来（Hook 就是个普通函数调用），只在特定交互后才爆，
 * 所以用一条静态契约兜住：**组件函数体里的提前 return 之后不允许再出现 Hook**。
 *
 * 只扫"组件函数体"：从顶层 `function X(` / `const X = (...) =>` 开始按花括号配对，
 * 到配平为止。文件级的辅助函数、事件处理器内部的 return 都不算——
 * 第一版没做作用域限制，扫出 62 条全是误报。
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOOK_CALL = /\buse(?:State|Effect|LayoutEffect|Memo|Callback|Ref|Reducer|Context|Id|SyncExternalStore|Transition|DeferredValue)\s*[(<]/;
/** 组件体里的提前返回：两空格缩进。 */
const EARLY_RETURN = /^ {2}if \(.+\) return (?:null|undefined|<)/;
const COMPONENT_DECL = /^(?:export\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/;

interface Body {
  name: string;
  start: number;
  end: number;
}

function componentBodies(lines: string[]): Body[] {
  const bodies: Body[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = COMPONENT_DECL.exec(lines[index]);
    if (!match) continue;
    const name = match[1] ?? match[2];
    let depth = 0;
    let opened = false;
    let end = index;
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      for (const char of lines[cursor]) {
        if (char === '{') { depth += 1; opened = true; }
        else if (char === '}') depth -= 1;
      }
      if (opened && depth === 0) { end = cursor; break; }
    }
    bodies.push({ name, start: index, end });
    index = end;
  }
  return bodies;
}

interface Violation {
  file: string;
  component: string;
  guard: string;
  hook: string;
}

function scan(file: string): Violation[] {
  const lines = readFileSync(join(here, file), 'utf8').split('\n');
  const violations: Violation[] = [];
  for (const body of componentBodies(lines)) {
    const guard = lines.slice(body.start, body.end + 1).findIndex(line => EARLY_RETURN.test(line));
    if (guard < 0) continue;
    const guardLine = body.start + guard;
    for (let index = guardLine + 1; index <= body.end; index += 1) {
      const line = lines[index];
      if (!/^ {2}\S/.test(line)) continue;
      if (!HOOK_CALL.test(line)) continue;
      violations.push({ file, component: body.name, guard: lines[guardLine].trim(), hook: line.trim().slice(0, 70) });
    }
  }
  return violations;
}

describe('hook order stays stable across render paths', () => {
  it('no component calls a Hook after its early return', () => {
    const files = readdirSync(here).filter(name => name.endsWith('.tsx') && !name.includes('.test.'));
    expect(files.flatMap(scan)).toEqual([]);
  });

  it('actually sees the guard in the wizard (the file where this broke)', () => {
    const source = readFileSync(join(here, 'ImportBlueprintWizard.tsx'), 'utf8');
    expect(source).toContain('if (!isOpen) return null;');
    expect(scan('ImportBlueprintWizard.tsx')).toEqual([]);
  });
});

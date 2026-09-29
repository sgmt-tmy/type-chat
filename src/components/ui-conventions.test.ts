import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COLORS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW_COLOR = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:)*[a-z]+-(?:(?:${COLORS})-(?:50|100|200|300|400|500|600|700|800|900|950)|black|white)(?![\w-])`,
  "g",
);
const ARBITRARY_VALUE = /(?<![\w-])(?:[\w-]+:)*[\w-]*-?\[[^\]\s]*\]/g;
const SET_INTERVAL = /\bsetInterval\s*\(/g;

export function findViolations(content: string): string[] {
  return [
    ...(content.match(RAW_COLOR) ?? []),
    ...(content.match(ARBITRARY_VALUE) ?? []),
    ...(content.match(SET_INTERVAL) ?? []),
  ];
}

const root = path.resolve(import.meta.dirname, "..");

function isTarget(relative: string): boolean {
  return (
    relative.endsWith(".tsx") &&
    !relative.endsWith(".test.tsx") &&
    !relative.startsWith("components/ui/") &&
    !relative.startsWith("app/api/")
  );
}

export function listTargetFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["app", "components"]) {
    const entries = readdirSync(path.join(root, dir), {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const relative = path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/");
      if (isTarget(relative)) files.push(relative);
    }
  }
  return files.sort();
}

describe("findViolations", () => {
  it.each(["bg-blue-500", "text-white", "hover:border-gray-200"])(
    "生の色クラス %s を違反として返す",
    (cls) => {
      expect(findViolations(`<div className="${cls}" />`)).toEqual([cls]);
    },
  );

  it("テーマトークンのクラスだけなら違反を返さない", () => {
    const content =
      '<div className="bg-primary text-muted-foreground text-destructive border-border bg-transparent" />';
    expect(findViolations(content)).toEqual([]);
  });

  it.each(["p-[13px]", "w-[320px]", "bg-[#1e40af]"])(
    "任意値 %s を違反として返す",
    (cls) => {
      expect(findViolations(`<div className="${cls}" />`)).toEqual([cls]);
    },
  );

  it("setInterval の呼び出しを違反として返す", () => {
    expect(findViolations("setInterval(() => {}, 1000)")).not.toEqual([]);
  });
});

describe("走査対象", () => {
  it("ui/・app/api/・テストファイルを含まない", () => {
    const files = listTargetFiles();
    expect(files).toContain("app/layout.tsx");
    expect(files.some((f) => f.startsWith("components/ui/"))).toBe(false);
    expect(files.some((f) => f.startsWith("app/api/"))).toBe(false);
    expect(files.some((f) => f.endsWith(".test.tsx"))).toBe(false);
  });

  it("実際のファイルに違反が0件である", () => {
    const messages = listTargetFiles().flatMap((file) =>
      findViolations(readFileSync(path.join(root, file), "utf8")).map(
        (v) => `src/${file}: ${v}`,
      ),
    );
    expect(messages).toEqual([]);
  });
});

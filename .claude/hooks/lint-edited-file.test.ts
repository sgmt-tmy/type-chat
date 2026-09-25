import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./lint-edited-file.js", import.meta.url));
// ESLintのflat configはconfigファイルの外にあるファイルを常に無視するため、
// テスト用の一時ファイルはプロジェクト配下に作る
const fixturesRoot = fileURLToPath(new URL("./__fixtures__/", import.meta.url));

function runHook(filePath: string) {
  return spawnSync("node", [hookPath], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: "utf-8",
  });
}

let tempDir: string | undefined;

beforeAll(() => {
  mkdirSync(fixturesRoot, { recursive: true });
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

afterAll(() => {
  rmSync(fixturesRoot, { recursive: true, force: true });
});

describe("lint-edited-file", () => {
  it(".ts以外のファイルは何もせず終了コード0で終わる", () => {
    const result = runHook("README.md");
    expect(result.status).toBe(0);
  });

  it("lintエラーがないtsファイルは終了コード0で終わる", () => {
    tempDir = mkdtempSync(join(fixturesRoot, "ok-"));
    const filePath = join(tempDir, "ok.ts");
    writeFileSync(filePath, "export const value: number = 1;\n");

    const result = runHook(filePath);

    expect(result.status).toBe(0);
  });

  it("lintエラーがあるtsファイルは終了コード2で標準エラーに内容を出す", () => {
    tempDir = mkdtempSync(join(fixturesRoot, "ng-"));
    const filePath = join(tempDir, "ng.ts");
    writeFileSync(filePath, "const unused = 1;\n");

    const result = runHook(filePath);

    expect(result.status).toBe(2);
    expect(result.stderr).not.toBe("");
  });
});

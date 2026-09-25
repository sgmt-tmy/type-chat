import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SPECS_DIR = fileURLToPath(new URL("../docs/specs/", import.meta.url));
export const VALID_STATUSES = ["draft", "approved", "implemented", "deprecated"];
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TEMPLATE_FILE_NAME = "_template.md";

/**
 * frontmatter（1行目 `---` から次の `---` まで）を key: value の組として取り出す。
 * 1行目が `---` でない、または閉じる `---` が無い場合はエラーを返す。
 */
export function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { error: "1行目が --- ではありません" };
  }

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) {
    return { error: "frontmatterを閉じる --- が見つかりません" };
  }

  const fields = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, rawValue] = match;
      fields[key] = rawValue.split("#")[0].trim();
    }
  }

  return { fields, bodyLines: lines.slice(closingIndex + 1) };
}

/**
 * 「## 受け入れ条件」セクション内にチェックボックスが1つ以上あり、
 * かつすべて [x] かどうかを判定する。
 */
export function isAcceptanceCriteriaAllChecked(bodyLines) {
  let inSection = false;
  let found = false;
  let allChecked = true;

  for (const line of bodyLines) {
    if (/^##\s+受け入れ条件/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) {
      break;
    }
    if (!inSection) {
      continue;
    }

    const checkbox = line.match(/^-\s\[([ x])\]/);
    if (checkbox) {
      found = true;
      if (checkbox[1] !== "x") {
        allChecked = false;
      }
    }
  }

  return found && allChecked;
}

/**
 * 1つの仕様書ファイルの内容を検証する。
 * 戻り値の errors は check スクリプトを失敗させ、warnings は失敗させない。
 */
export function checkSpecFile(fileName, content) {
  const errors = [];
  const warnings = [];

  const parsed = parseFrontmatter(content);
  if (parsed.error) {
    errors.push(`${fileName}: ${parsed.error}`);
    return { errors, warnings };
  }

  const { fields, bodyLines } = parsed;

  if (!fields.status) {
    errors.push(`${fileName}: frontmatterに status がありません`);
  } else if (!VALID_STATUSES.includes(fields.status)) {
    errors.push(
      `${fileName}: status の値が不正です（${fields.status}）。${VALID_STATUSES.join(" / ")} のいずれかにしてください`,
    );
  }

  if (!fields.updated) {
    errors.push(`${fileName}: frontmatterに updated がありません`);
  } else if (!DATE_PATTERN.test(fields.updated)) {
    errors.push(`${fileName}: updated の形式が不正です（${fields.updated}）。YYYY-MM-DD形式にしてください`);
  }

  if (fields.status === "approved" && isAcceptanceCriteriaAllChecked(bodyLines)) {
    warnings.push(
      `${fileName}: 受け入れ条件がすべて [x] ですが status が approved のままです（実装済みへの更新漏れの可能性）`,
    );
  }

  return { errors, warnings };
}

export function listSpecFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== TEMPLATE_FILE_NAME)
    .sort();
}

function main() {
  const files = listSpecFiles(SPECS_DIR);
  let hasError = false;

  for (const fileName of files) {
    const content = readFileSync(join(SPECS_DIR, fileName), "utf-8");
    const { errors, warnings } = checkSpecFile(fileName, content);

    for (const error of errors) {
      console.error(`[error] ${error}`);
      hasError = true;
    }
    for (const warning of warnings) {
      console.warn(`[warn] ${warning}`);
    }
  }

  process.exit(hasError ? 1 : 0);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

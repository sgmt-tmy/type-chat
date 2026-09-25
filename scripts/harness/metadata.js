// ハーネスのタスクIssue本文から、メタデータブロックを取り出して検証する。
// 書式は .claude/harness/conventions.md の「メタデータブロック」を参照。

export const METADATA_HEADING = "## ハーネスメタデータ";
export const REQUIRED_KEYS = ["id", "depends_on", "gate", "gate_reasons", "risk", "max_attempts"];
export const GATE_REASONS = [
  "irreversible",
  "spec_ambiguity",
  "failure_threshold",
  "risk_cost",
  "security_boundary",
];
export const RISKS = ["low", "medium", "high"];
const ID_PATTERN = /^T\d+$/;
const ISSUE_REF_PATTERN = /^#(\d+)$/;

/**
 * 「## ハーネスメタデータ」セクション（次の見出しまで）の中で、最初の ```yaml ブロックの中身（行の配列）を返す。
 * 見つからなければ undefined。
 */
function extractBlockLines(lines) {
  const headingIndex = lines.findIndex((line) => line.trim() === METADATA_HEADING);
  if (headingIndex === -1) {
    return undefined;
  }

  const sectionLines = lines.slice(headingIndex + 1);
  const nextHeadingOffset = sectionLines.findIndex((line) => /^#{1,2} /.test(line));
  const section = nextHeadingOffset === -1 ? sectionLines : sectionLines.slice(0, nextHeadingOffset);

  const openIndex = section.findIndex((line) => line.trim() === "```yaml");
  if (openIndex === -1) {
    return undefined;
  }

  const closeOffset = section.slice(openIndex + 1).findIndex((line) => line.trim() === "```");
  if (closeOffset === -1) {
    return undefined;
  }

  return section.slice(openIndex + 1, openIndex + 1 + closeOffset);
}

/** `[a, b]` 形式のインライン配列を要素の配列にする。配列でなければ undefined。 */
function parseInlineList(raw) {
  const match = raw.match(/^\[(.*)\]$/);
  if (!match) {
    return undefined;
  }
  const inner = match[1].trim();
  return inner === "" ? [] : inner.split(",").map((item) => item.trim());
}

/**
 * Issue本文をパースし、メタデータを返す。
 * 成功時は { metadata }、失敗時は { errors }（1件以上）を返す。
 */
export function parseHarnessMetadata(body) {
  const blockLines = extractBlockLines(body.split(/\r?\n/));
  if (!blockLines) {
    return { errors: [`「${METADATA_HEADING}」セクションに \`\`\`yaml ブロックがありません`] };
  }

  const errors = [];
  const raw = {};
  for (const line of blockLines) {
    if (line.trim() === "") {
      continue;
    }
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) {
      errors.push(`key: value の形式ではない行があります（${line}）`);
      continue;
    }
    const [, key, value] = match;
    if (!REQUIRED_KEYS.includes(key)) {
      errors.push(`未知のキーです（${key}）`);
    } else if (key in raw) {
      errors.push(`キーが重複しています（${key}）`);
    } else {
      raw[key] = value.trim();
    }
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in raw)) {
      errors.push(`必須キーがありません（${key}）`);
    }
  }

  const metadata = {};

  if ("id" in raw) {
    if (ID_PATTERN.test(raw.id)) {
      metadata.id = raw.id;
    } else {
      errors.push(`id の形式が不正です（${raw.id}）。T<数字> にしてください`);
    }
  }

  if ("depends_on" in raw) {
    const items = parseInlineList(raw.depends_on);
    if (!items) {
      errors.push(`depends_on は [#番号, ...] の形式にしてください（${raw.depends_on}）`);
    } else {
      const invalid = items.filter((item) => !ISSUE_REF_PATTERN.test(item));
      if (invalid.length > 0) {
        errors.push(`depends_on の要素は #<Issue番号> にしてください（${invalid.join(", ")}）`);
      } else {
        metadata.depends_on = items.map((item) => Number(item.slice(1)));
      }
    }
  }

  if ("gate" in raw) {
    if (raw.gate === "true" || raw.gate === "false") {
      metadata.gate = raw.gate === "true";
    } else {
      errors.push(`gate は true / false のいずれかにしてください（${raw.gate}）`);
    }
  }

  if ("gate_reasons" in raw) {
    const items = parseInlineList(raw.gate_reasons);
    if (!items) {
      errors.push(`gate_reasons は [区分, ...] の形式にしてください（${raw.gate_reasons}）`);
    } else {
      const invalid = items.filter((item) => !GATE_REASONS.includes(item));
      if (invalid.length > 0) {
        errors.push(
          `gate_reasons に不正な区分があります（${invalid.join(", ")}）。${GATE_REASONS.join(" / ")} のいずれかにしてください`,
        );
      } else {
        metadata.gate_reasons = items;
      }
    }
  }

  if ("risk" in raw) {
    if (RISKS.includes(raw.risk)) {
      metadata.risk = raw.risk;
    } else {
      errors.push(`risk の値が不正です（${raw.risk}）。${RISKS.join(" / ")} のいずれかにしてください`);
    }
  }

  if ("max_attempts" in raw) {
    if (/^[1-9]\d*$/.test(raw.max_attempts)) {
      metadata.max_attempts = Number(raw.max_attempts);
    } else {
      errors.push(`max_attempts は1以上の整数にしてください（${raw.max_attempts}）`);
    }
  }

  if (metadata.gate === true && metadata.gate_reasons?.length === 0) {
    errors.push("gate: true のときは gate_reasons を1つ以上書いてください");
  }
  if (metadata.gate === false && (metadata.gate_reasons?.length ?? 0) > 0) {
    errors.push("gate: false のときは gate_reasons を空（[]）にしてください");
  }

  return errors.length > 0 ? { errors } : { metadata };
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

async function main() {
  const input = readFileSync(0, "utf-8");
  const payload = JSON.parse(input);
  const filePath = payload?.tool_input?.file_path;

  if (!filePath || !filePath.endsWith(".ts")) {
    process.exit(0);
  }

  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: fileURLToPath(new URL("../../eslint.config.js", import.meta.url)),
  });
  const results = await eslint.lintFiles([filePath]);
  const formatter = await eslint.loadFormatter("stylish");
  const hasErrors = results.some((result) => result.errorCount > 0);

  if (hasErrors) {
    const output = await formatter.format(results);
    process.stderr.write(output);
    process.exit(2);
  }

  process.exit(0);
}

main();

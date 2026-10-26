// Static checks of the app.
//
//     node tests/run_static_checks.mjs [--tools <folder with node_modules>]
//
//   syntax     node --check on every script
//   eslint     the recommended rules and the stricter ones of eslint.config.mjs
//   tsc        TypeScript type checking of the JavaScript (JSDoc types, tsconfig.json: strict)
//   html       html-validate on index.html
//   page       every element id the scripts look up exists in index.html, every script the page
//              loads exists, and the vendored files match the SHA-256 listed in vendor/LICENSES.md
//
// The tools come from node_modules here (after "npm install"), or from --tools: then the checked
// files are copied into <tools>/sem_measurement_tool_check, where the tools and their plugins resolve.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKED = ["js", "types", "tests", "index.html", "eslint.config.mjs", "tsconfig.json", ".htmlvalidate.json"];

function toolsRoot() {
  const at = process.argv.indexOf("--tools");
  if (at >= 0 && process.argv[at + 1]) {
    return path.resolve(process.argv[at + 1]);
  }
  return fs.existsSync(path.join(ROOT, "node_modules")) ? ROOT : null;
}

function workFolder(tools) {
  if (tools === ROOT) {
    return ROOT;
  }
  const work = path.join(tools, "sem_measurement_tool_check");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  for (const name of CHECKED) {
    fs.cpSync(path.join(ROOT, name), path.join(work, name), { recursive: true });
  }
  return work;
}

function run(name, args, cwd) {
  console.log(`==== ${name}`);
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf-8" });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (output) {
    console.log(output);
  }
  const ok = result.status === 0;
  console.log(`---- ${name}: ${ok ? "ok" : `FAILED (exit ${result.status})`}\n`);
  return ok;
}

function pageChecks() {
  const problems = [];
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf-8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const file of fs.readdirSync(path.join(ROOT, "js"))) {
    const code = fs.readFileSync(path.join(ROOT, "js", file), "utf-8");
    for (const m of code.matchAll(/\b(?:el|inputEl|selectEl)\("([^"]+)"\)/g)) {
      if (!ids.has(m[1])) {
        problems.push(`js/${file}: element #${m[1]} is not in index.html`);
      }
    }
    for (const m of code.matchAll(/for \(const id of \[([^\]]+)\]\)/g)) {
      for (const id of m[1].match(/"([^"]+)"/g) || []) {
        if (!ids.has(id.slice(1, -1))) {
          problems.push(`js/${file}: element #${id.slice(1, -1)} is not in index.html`);
        }
      }
    }
  }
  for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) {
      problems.push(`index.html loads ${m[1]}, which does not exist`);
    }
  }
  const licenses = fs.readFileSync(path.join(ROOT, "vendor", "LICENSES.md"), "utf-8");
  for (const m of licenses.matchAll(/\| `([^`]+)` \|[^\n]*\| `([0-9a-f]{64})` \|/g)) {
    const file = path.join(ROOT, "vendor", m[1]);
    const digest = fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
    if (digest !== m[2]) {
      problems.push(`vendor/${m[1]}: SHA-256 ${digest} differs from vendor/LICENSES.md`);
    }
  }
  return problems;
}

function main() {
  const results = {};
  const scripts = [...fs.readdirSync(path.join(ROOT, "js")).map((f) => path.join("js", f)),
    ...fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".mjs")).map((f) => path.join("tests", f))];
  results.syntax = scripts.every((f) => run(`syntax ${f}`, ["--check", f], ROOT));
  const tools = toolsRoot();
  if (tools === null) {
    console.log("No node_modules here and no --tools: eslint, tsc and html-validate are skipped.\n");
  } else {
    const work = workFolder(tools);
    const bin = (...p) => path.join(tools, "node_modules", ...p);
    results.eslint = run("eslint", [bin("eslint", "bin", "eslint.js"), "--max-warnings", "0", "js", "tests", "eslint.config.mjs"], work);
    results.tsc = run("tsc", [bin("typescript", "bin", "tsc"), "-p", "tsconfig.json"], work);
    results.html = run("html-validate", [bin("html-validate", "bin", "html-validate.mjs"), "index.html"], work);
  }
  console.log("==== page");
  const problems = pageChecks();
  console.log(problems.length ? problems.join("\n") : "element ids, script files and vendored checksums agree");
  results.page = problems.length === 0;
  console.log(`---- page: ${results.page ? "ok" : "FAILED"}\n`);
  console.log(`summary: ${Object.entries(results).map(([k, v]) => `${k} ${v ? "ok" : "FAILED"}`).join(", ")}`);
  process.exit(Object.values(results).every(Boolean) ? 0 : 1);
}

main();

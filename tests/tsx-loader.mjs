// Lets the Node test runner import React components directly.
//
// Node strips TypeScript types natively but does not compile JSX, and it
// cannot resolve the "@/" path alias. This loader handles both, using the
// TypeScript compiler that is already a dev dependency, so component tests
// need no new packages and no bundler.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../", import.meta.url);

const resolveFile = (relPath) => {
  const base = new URL(relPath, root);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = new URL(base.href + ext);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
};

export async function resolve(specifier, context, next) {
  if (specifier === "next/image") {
    const stub = resolveFile("tests/stubs/next-image");
    if (!stub) throw new Error("Missing tests/stubs/next-image.tsx");
    return next(stub, context);
  }
  if (specifier === "next/dynamic") {
    const stub = resolveFile("tests/stubs/next-dynamic");
    if (!stub) throw new Error("Missing tests/stubs/next-dynamic.tsx");
    return next(stub, context);
  }
  if (specifier.startsWith("@/")) {
    const found = resolveFile(specifier.slice(2));
    if (!found) {
      throw new Error(`Cannot resolve "${specifier}" from ${context.parentURL}`);
    }
    return next(found, context);
  }
  // Relative imports inside components/ are written without a file extension,
  // which is what Next.js expects but native ESM resolution rejects. Try the
  // TypeScript extensions first, then fall back to the specifier untouched so
  // real files with their own extension (notably CSS) still resolve.
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  // Server components may import CSS for their route. Node cannot parse
  // it, and tests care about markup rather than styling.
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  if (!url.endsWith(".tsx")) return next(url, context);

  const filename = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
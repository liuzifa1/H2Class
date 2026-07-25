export const resolve = async (specifier, context, nextResolve) => {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") && !specifier.startsWith("file:")) {
      throw error;
    }
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      throw error;
    }
  }
};

export const load = async (url, context, nextLoad) => {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: fileURLToPath(url),
  });
  return { format: "module", shortCircuit: true, source: transpiled.outputText };
};
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

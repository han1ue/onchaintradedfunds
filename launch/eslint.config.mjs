import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const compat = new FlatCompat({
  baseDirectory,
  resolvePluginsRelativeTo: path.dirname(require.resolve("eslint-config-next")),
});
export default [...compat.extends("next/core-web-vitals", "next/typescript")];

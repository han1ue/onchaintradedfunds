import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const artifact = (source, contract) => JSON.parse(readFileSync(
  resolve(root, "contracts", "out", source, `${contract}.json`),
  "utf8",
));
const signature = (item) => `${item.type}:${item.name ?? ""}:${JSON.stringify(item.inputs ?? [])}`;
const core = artifact("ManagedOTFVault.sol", "ManagedOTFVault").abi;
const view = artifact("ManagedOTFVaultView.sol", "ManagedOTFVaultView").abi;
const viewFunctions = new Set(view.filter((item) => item.type === "function").map(signature));
const union = [];
const seen = new Set();
for (const item of [...core.filter((item) => item.type !== "function" || !viewFunctions.has(signature(item))), ...view]) {
  const key = signature(item);
  if (seen.has(key)) continue;
  seen.add(key);
  union.push(item);
}

const generatedPath = resolve(root, "packages", "generated", "src", "index.ts");
const generated = readFileSync(generatedPath, "utf8");
const start = generated.indexOf("export const managedOtfVaultAbi = ");
const routerStart = generated.indexOf("export const otfEntryExitRouterAbi = ");
const routerEnd = generated.indexOf("export const registeredUniswapV3AdapterAbi = ");
if (start === -1 || routerStart === -1 || routerEnd === -1) {
  throw new Error("generated ABI boundaries were not found");
}
const router = artifact("OTFEntryExitRouter.sol", "OTFEntryExitRouter").abi;
const replacement = [
  `export const managedOtfVaultAbi = ${JSON.stringify(union, null, 2)} as const;`,
  "",
  `export const otfEntryExitRouterAbi = ${JSON.stringify(router, null, 2)} as const;`,
  "",
].join("\n");
writeFileSync(
  generatedPath,
  `${generated.slice(0, start)}${replacement}${generated.slice(routerEnd)}`,
);

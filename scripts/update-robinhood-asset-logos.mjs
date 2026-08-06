import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiUrl = "https://api.robinhood.com/rhj/assets";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(root, "app", "src", "config", "supported-assets.json");

function deploymentKey(chainId, contractAddress) {
  return `${Number(chainId)}:${String(contractAddress).toLowerCase()}`;
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const response = await fetch(apiUrl, { headers: { accept: "application/json" } });

if (!response.ok) {
  throw new Error(`Robinhood asset metadata request failed with ${response.status} ${response.statusText}.`);
}

const payload = await response.json();
if (!Array.isArray(payload.assets)) {
  throw new Error("Robinhood asset metadata response did not contain an assets array.");
}

const metadataByDeployment = new Map();
for (const asset of payload.assets) {
  if (!asset.logoUrl || !Array.isArray(asset.deployments)) continue;
  for (const deployment of asset.deployments) {
    metadataByDeployment.set(
      deploymentKey(deployment.chainId, deployment.contractAddress),
      asset,
    );
  }
}

const unmatched = [];
let updated = 0;
for (const asset of catalog.assets ?? []) {
  const match = (asset.deployments ?? [])
    .map((deployment) => metadataByDeployment.get(
      deploymentKey(deployment.chainId, deployment.contractAddress),
    ))
    .find(Boolean);

  if (!match) {
    unmatched.push(asset.symbol ?? "Unknown asset");
    continue;
  }

  if (asset.logoUrl !== match.logoUrl) updated += 1;
  asset.logoUrl = match.logoUrl;
}

if (unmatched.length) {
  throw new Error(`No Robinhood chain/address metadata match for: ${unmatched.join(", ")}.`);
}

await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Matched ${catalog.assets.length} supported assets; updated ${updated} logo URL(s).`);

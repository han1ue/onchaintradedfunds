import { createRequire } from "node:module";
const { getAddress, isAddress, zeroAddress } = createRequire(new URL("../../app/package.json", import.meta.url))("viem");

export function mainnetPreparation(config, pin, deployerAddress) {
  if (config.chainId !== 4663 || config.network !== "robinhood-mainnet" || pin.chainId !== 4663) throw new Error("Mainnet preparation requires chain 4663");
  if (config.deploymentPolicy?.broadcastEnabled !== false) throw new Error("Mainnet broadcasting must remain disabled during preparation");
  for (const role of ["protocolAdministrator", "teamBeneficiary"]) {
    if (config.deploymentPolicy[role] !== "deployer") throw new Error(`Unreviewed mainnet role policy: ${role}`);
  }
  for (const [key, dependency] of Object.entries(pin.dependencies)) {
    if (config.externalContracts[key]?.toLowerCase() !== dependency.address.toLowerCase()) throw new Error(`Mainnet configuration differs from pinned ${key}`);
  }
  if (config.uniswapTradingApi.universalRouter.toLowerCase() !== config.externalContracts.uniswapUniversalRouter.toLowerCase()
    || config.uniswapTradingApi.permit2.toLowerCase() !== config.externalContracts.permit2.toLowerCase()) throw new Error("Trading API targets differ from deployment targets");
  if (!Number.isSafeInteger(config.oracleValidation.maxAgeSeconds) || config.oracleValidation.maxAgeSeconds <= 0) throw new Error("Invalid mainnet oracle maximum age");
  if (deployerAddress !== undefined && (!isAddress(deployerAddress) || deployerAddress.toLowerCase() === zeroAddress)) throw new Error("DEPLOYER_ADDRESS must be a nonzero address");
  const deployer = deployerAddress ? getAddress(deployerAddress) : undefined;
  return {
    chainId: 4663, broadcastEnabled: false,
    roles: { deployer: deployer ?? null, protocolAdministrator: deployer ?? "deployer", teamBeneficiary: deployer ?? "deployer" },
    oracleMaxAgeSeconds: config.oracleValidation.maxAgeSeconds,
    deploymentOrder: ["otfToken", "launchManagerDeployer", "launchManager", "launchRouter", "buybackCollector", "vaultImplementation", "factory", "entryRouter", "uniswapV3Adapter", "uniswapV4Adapter", "teamVesting", "merkleRewardsDistributor"],
    pending: [
      ...(!deployer ? ["Set DEPLOYER_ADDRESS to resolve initial roles to a concrete public address."] : []),
      "Deploy protocol contracts only after a separate deployment instruction.",
      "Record confirmed addresses, rewards deployment block and timestamp, and approved adapters in the mainnet manifest.",
      "Initialize the canonical OTF pool and verify live basket quotes and simulations before enabling mainnet trading.",
    ],
  };
}

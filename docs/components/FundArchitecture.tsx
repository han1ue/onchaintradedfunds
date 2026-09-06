import Image from "next/image";

export function FundArchitecture() {
  return (
    <figure className="fundArchitecture">
      <p className="fundArchitectureHint">Scroll horizontally to explore the diagram.</p>
      <div
        className="fundArchitectureScroll"
        role="region"
        aria-label="Fund architecture diagram, scroll horizontally on smaller screens"
        tabIndex={0}
      >
        <Image
          src="/diagrams/fund-architecture.svg"
          alt="The application supplies basket units to OTFFactory, which creates a ManagedOTFVault. Holders mint or redeem through OTFEntryExitRouter and approved Uniswap V3 or V4 adapters, or redeem basket tokens directly from the vault. The vault holds the tokens and accounts for fund shares."
          width={960}
          height={1100}
          className="fundArchitectureImage"
          unoptimized
        />
      </div>
      <figcaption>
        <span>Fund creation, direct redemption, and routed basket settlement.</span>
        <a href="/diagrams/fund-architecture.svg" target="_blank" rel="noreferrer">
          Open full-size diagram
        </a>
      </figcaption>
    </figure>
  );
}

import Link from "next/link";
import { OtfBrandMark } from "@onchaintradedfunds/brand";

export function BrandMark() {
  return <Link className="brandMarkLink" href="/" aria-label="OTF Launch Competition home"><OtfBrandMark /></Link>;
}

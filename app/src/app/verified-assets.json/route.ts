import verifiedAssets from "../../config/verified_assets.json";

export function GET() {
  return Response.json(verifiedAssets);
}

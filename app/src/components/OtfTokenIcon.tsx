type OtfTokenIconProps = {
  className?: string;
  size?: number;
};

export function OtfTokenIcon({ className, size = 32 }: OtfTokenIconProps) {
  return (
    // Canonical app rendering of the SVG embedded in the OTF ERC-1046 metadata.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src="/assets/otf-token.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
    />
  );
}

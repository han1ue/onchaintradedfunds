import Image from "next/image";

export function XProfileImage({ src, username, size = 28 }: { src?: string | null; username: string; size?: number }) {
  if (!src) return <span className="xProfileImage xProfileImageFallback" style={{ width: size, height: size }} aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>;
  return <Image className="xProfileImage" src={src} alt="" width={size} height={size} sizes={`${size}px`} unoptimized />;
}

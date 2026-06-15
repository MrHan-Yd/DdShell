export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/logo-aurora-dark.svg"
      alt="DdShell"
      width={size}
      height={size}
    />
  );
}

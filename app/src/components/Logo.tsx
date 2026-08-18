export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/logo-frostplain-dark.svg"
      alt="DdShell"
      width={size}
      height={size}
    />
  );
}

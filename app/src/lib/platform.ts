export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toUpperCase().includes("MAC");
}

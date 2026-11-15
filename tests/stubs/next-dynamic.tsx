/**
 * next/dynamic for tests that mount the app shell.
 *
 * The code-split screens behind it are loaded on navigation in the real app;
 * these tests exercise the entry and identity surfaces, so a placeholder keeps
 * the shell mountable without a Next runtime. Each loader is deliberately not
 * called: the point is that the shell can render without those chunks.
 */
export default function dynamic() {
  function DynamicPlaceholder() {
    return null;
  }
  DynamicPlaceholder.displayName = "DynamicPlaceholder";
  return DynamicPlaceholder;
}

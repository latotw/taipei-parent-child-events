/**
 * 讓 node --test 認得 tsconfig 裡的 "@/*" → "src/*" 別名。
 * 只在測試時用（見 package.json 的 test:* script），不影響 Next 的建置。
 */
const SRC = new URL("../src/", import.meta.url);

export function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const target = new URL(specifier.slice(2), SRC).href;
  return next(/\.[mc]?tsx?$/.test(target) ? target : `${target}.ts`, context);
}

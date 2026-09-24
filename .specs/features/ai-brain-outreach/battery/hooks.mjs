export async function resolve(spec, ctx, next) {
  if (spec.startsWith('npm:@supabase/')) return { url: new URL('./stub-supabase.mjs', import.meta.url).href, shortCircuit: true };
  if (spec === './get-ai-config.ts') return { url: new URL('./stub-groq.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}

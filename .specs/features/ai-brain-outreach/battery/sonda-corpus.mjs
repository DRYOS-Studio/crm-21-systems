// Sonda de satisfazibilidade: a implementação REAL de brain.ts passa nos corpora
// positivos E negativos da spec? (T10: importa de brain.ts, não duplica regex.)
const BRAIN = process.env.BRAIN || new URL("../../../../supabase/functions/_shared/brain.ts", import.meta.url).pathname;
const b = await import(BRAIN);
const tests = await import("node:fs").then((fs) => fs.readFileSync(new URL("./tests.mjs", import.meta.url), "utf8"));
const lists = [...tests.matchAll(/for \(const txt of (\[[^\]]+\])/g)].map((m) => eval(m[1]));
const [humPos, sairPos, sairNeg, humNeg] = lists; // ordem no tests.mjs: A4, A5, A5n, A4n
const bad = [
  ...sairPos.filter((t) => !b.pediuParaSair(t)).map((t) => "A5 miss: " + t),
  ...sairNeg.filter((t) => b.pediuParaSair(t)).map((t) => "A5n FP: " + t),
  ...humPos.filter((t) => !b.pediuHumano(t)).map((t) => "A4 miss: " + t),
  ...humNeg.filter((t) => b.pediuHumano(t)).map((t) => "A4n FP: " + t),
];
console.log(`corpora: A4=${humPos.length} A4n=${humNeg.length} A5=${sairPos.length} A5n=${sairNeg.length}`);
console.log(bad.length ? bad.join("\n") : "SATISFAZÍVEL: pediuParaSair/pediuHumano (brain.ts real) passam em todos");

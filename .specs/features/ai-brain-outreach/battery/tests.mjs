// Bateria da Fase 1: cada teste é um AC da spec. Roda sobre BRAIN (path do módulo).
const BRAIN = process.env.BRAIN;
const b = await import(BRAIN);
const res = [];
async function t(id, fn) { globalThis.__calls = 0; try { await fn(); res.push([id,'PASS']); } catch (e) { res.push([id,'FAIL: '+String(e.message).slice(0,90)]); } }
const ok = (c, m) => { if (!c) throw new Error(m); };
const reply = o => ({ ok: true, reply: JSON.stringify(o) });
const base = { mensagens:['oi'], etapa:'descobrir', qualificacao:{}, qualificado:false, resumo:null, optout:false, escalar:false, motivo_escalar:null };
// admin stub: honra .eq() — linhas de 2 tenants
const ROWS = [{user_id:'u2',topic:'precos',content:'U2-PRECO'},{user_id:'u1',topic:'precos',content:'U1-PRECO'},{user_id:'u2',topic:'segredo',content:'U2-SEGREDO'}];
function admin() { return { from(){ const f=[]; const q={ select(){return q;}, eq(k,v){f.push([k,v]);return q;},
  maybeSingle: async()=>({data: ROWS.filter(r=>f.every(([k,v])=>r[k]===v))[0]||null}),
  then(r){ return Promise.resolve({data: ROWS.filter(r2=>f.every(([k,v])=>r2[k]===v))}).then(r);} }; return q; } }; }
const agent = { apiKey:'k', model:'m', businessContext:'ctx' };
const conv = (o={}) => ({ etapa:'descobrir', dados:{}, confirmacoes:0, ...o });
// D5: a janela é só o texto das mensagens ainda não processadas — aqui, tudo que veio depois
// do último turno 'assistant' (T11). É a mesma heurística usada pra montar os cenários de
// AC-A4w/AC-A5w abaixo (mensagem antes da última outbound não pode entrar na janela).
const janelaDe = (history) => { const i = history.map((m) => m.role).lastIndexOf('assistant'); return history.slice(i + 1).filter((m) => m.role === 'user').map((m) => m.content); };
const turn = (history, o={}) => b.runBrainTurn({ admin: admin(), userId:'u1', agent, conversa: conv(o), historyMessages: history, janela: janelaDe(history) });
const H = txt => [{role:'user', content: txt}];

await t('AC-A1 navt-nao-resposta', () => { for (const v of ['não informado','n/a','???','NA']) ok(b.faltaNavt({necessidade:'perde lead',autoridade:'dono',volume:v}).includes('volume'), `volume "${v}" contou`);
  ok(b.faltaNavt({necessidade:'perde lead',autoridade:'dono',volume:'200 pedidos/mês'}).length===0, 'resposta real nao contou'); });
await t('AC-A2 gate-rebaixa', async () => { globalThis.__script = () => reply({...base, etapa:'convidar'});
  const r = await turn(H('ok')); ok(r.etapa==='descobrir', 'etapa='+r.etapa); ok(globalThis.__calls===2, 'reprompt calls='+globalThis.__calls); });
await t('AC-A2n gate-deixa-convite-legitimo', async () => { globalThis.__script = () => reply({...base, etapa:'convidar', qualificacao:{necessidade:'perde lead',autoridade:'dono',volume:'200/mês'}});
  const r = await turn(H('ok')); ok(r.etapa==='convidar', 'etapa='+r.etapa); ok(globalThis.__calls===1, 'calls='+globalThis.__calls); });
await t('AC-A2r reprompt-leva-recusa', async () => { let sys2=''; globalThis.__script = (n, msgs) => { if (n===2) sys2 = msgs[0].content; return reply({...base, etapa:'convidar'}); };
  await turn(H('ok')); ok(/RECUSOU/.test(sys2) && /necessidade/.test(sys2), 'reprompt sem a recusa'); });
await t('AC-A2r qualificacao-acumula-no-reprompt', async () => { globalThis.__script = (n) => n===1
    ? reply({...base, etapa:'convidar', qualificacao:{necessidade:'perde lead',autoridade:'dono'}})
    : reply({...base, etapa:'descobrir', qualificacao:{}});
  const r = await turn(H('ok'));
  ok(r.qualificacaoDoTurno.necessidade==='perde lead' && r.qualificacaoDoTurno.autoridade==='dono', 'perdeu qualificacao da 1a tentativa: '+JSON.stringify(r.qualificacaoDoTurno)); });
await t('AC-A3n confirmar-nao-escala-cedo', async () => {
  globalThis.__script = () => reply(base); let r = await turn(H('x'), {confirmacoes:1}); ok(!r.precisaEscalar && r.confirmacoes===1, '1 anterior sem promessa escalou/contou');
  globalThis.__script = () => reply({...base, mensagens:['vou confirmar']}); r = await turn(H('x'), {confirmacoes:0}); ok(!r.precisaEscalar && r.confirmacoes===1, '1a promessa escalou'); });
await t('AC-A3 confirmar-2x-escala', async () => { globalThis.__script = () => reply({...base, mensagens:['vou confirmar e te falo']});
  const r = await turn(H('e o preço?'), {confirmacoes:1}); ok(r.precisaEscalar, 'nao escalou com 2 promessas'); });
await t('AC-A4 humano-regex-escala', async () => { globalThis.__script = () => reply(base);
  for (const txt of ['quero falar com uma pessoa','tem alguém aí de verdade?','me passa pra um atendente','isso é um robô?']) { const r = await turn(H(txt)); ok(r.precisaEscalar, 'nao escalou: '+txt); } });
await t('AC-A5 sair-regex-optout', async () => { globalThis.__script = () => reply(base);
  for (const txt of ['pare','PARE!','para de me mandar mensagem','oi, não tenho interesse, obrigado','por favor, pare de me mandar mensagem','não quero mais receber','não tenho interesse','me tira da lista','sai da lista','quero descadastrar','stop','vou denunciar','isso é spam','não perturbe']) { const r = await turn(H(txt)); ok(r.optout, 'nao marcou optout: '+txt); } });
await t('AC-A5b sair-antes-da-IA', async () => { globalThis.__script = () => ({ok:false, error:'groq down'});
  let r=null; try { r = await turn(H('pare de me mandar mensagem')); } catch {} ok(r && r.optout, 'optout perdido com Groq falhando'); ok(globalThis.__calls===0, 'chamou IA: '+globalThis.__calls); });
await t('AC-A5n sair-sem-falso-positivo', async () => { globalThis.__script = () => reply(base);
  for (const txt of ['orçamento para amanhã','não quero pagar caro','para quando fica pronto?','vou sair do escritório às 18h','me tira uma dúvida','vocês não me enviaram o orçamento','o email caiu no spam','tira meu nome da nota e coloca o da empresa','pode parar o carro na frente?','você perdeu meu tempo ontem mas tudo bem, vamos fechar','o stop do carro quebrou, vocês consertam?','não quero perder essa promoção']) { const r = await turn(H(txt)); ok(!r.optout, 'falso optout: '+txt); } });
await t('AC-A4n humano-sem-falso-positivo', async () => { globalThis.__script = () => reply(base);
  for (const txt of ['queria falar com vocês sobre preço','me passa pra mim o valor','posso falar com vocês amanhã?','quero falar com vocês sobre o plano anual']) { const r = await turn(H(txt)); ok(!r.precisaEscalar, 'falso escalar: '+txt); } });
await t('AC-A4w janela-so-msgs-pendentes', async () => { globalThis.__script = () => reply(base);
  const r = await turn([{role:'user',content:'quero falar com uma pessoa'},{role:'assistant',content:'claro, chamei'},{role:'user',content:'ok obrigado'}]); ok(!r.precisaEscalar && !r.optout, 'regex aplicada a historico antigo'); });
await t('AC-A5w optout-so-janela', async () => { globalThis.__script = () => reply(base);
  const r = await turn([{role:'user',content:'não tenho interesse'},{role:'assistant',content:'tudo bem!'},{role:'user',content:'mudei de ideia, quanto custa?'}]); ok(!r.optout, 'optout por mensagem antiga'); });
await t('AC-A3o promessa-so-no-que-sai', async () => { globalThis.__script = () => reply({...base, mensagens:['a','b','vou confirmar']});
  const r = await turn(H('x'), {confirmacoes:1}); ok(r.confirmacoes===1 && !r.precisaEscalar, 'contou promessa da bolha cortada'); });
await t('AC-A5e optout-do-modelo-so-escala', async () => { globalThis.__script = () => reply({...base, optout:true});
  const r = await turn(H('hmm, deixa eu pensar')); ok(!r.optout, 'optout do modelo virou optout permanente'); ok(r.precisaEscalar, 'optout do modelo nao escalou'); });
await t('AC-A6 calendario-fuso-SP', async () => { const real = Date.now; Date.now = () => Date.parse('2026-09-24T02:00:00Z');
  try { let out; globalThis.__script = (n, msgs) => { if (n===1) return {ok:true, toolCalls:[{id:'1',type:'function',function:{name:'consultar_calendario',arguments:'{}'}}]}; out = JSON.parse(msgs.at(-1).content); return reply(base); };
    await turn(H('que dia é amanhã?')); ok(out[0].data==='2026-09-23' && out[0].rotulo==='hoje', 'hoje='+out[0].data); } finally { Date.now = real; } });
await t('AC-A7 kb-isolamento-tenant', async () => { let out; globalThis.__script = (n, msgs) => { if (n===1) return {ok:true, toolCalls:[{id:'1',type:'function',function:{name:'consultar_conhecimento',arguments:'{"assunto":"segredo"}'}}]}; out = msgs.at(-1).content; return reply(base); };
  await turn(H('x')); ok(!out.includes('U2-SEGREDO'), 'vazou conteudo de outro tenant'); ok(!out.includes('"segredo"') || JSON.parse(out).encontrado===false, 'topico de outro tenant aceito'); });
await t('AC-A7b kb-mesmo-topico-2-tenants', async () => { let out; globalThis.__script = (n, msgs) => { if (n===1) return {ok:true, toolCalls:[{id:'1',type:'function',function:{name:'consultar_conhecimento',arguments:'{"assunto":"precos"}'}}]}; out = JSON.parse(msgs.at(-1).content); return reply(base); };
  await turn(H('x')); ok(out.conteudo==='U1-PRECO', 'conteudo='+out.conteudo); });
await t('AC-A8 kb-topico-invalido', async () => { let out; globalThis.__script = (n, msgs) => { if (n===1) return {ok:true, toolCalls:[{id:'1',type:'function',function:{name:'consultar_conhecimento',arguments:'{"assunto":"xyz"}'}}]}; out = JSON.parse(msgs.at(-1).content); return reply(base); };
  await turn(H('x')); ok(out.encontrado===false && out.assuntos_validos.join()==='precos', JSON.stringify(out).slice(0,80)); });
await t('AC-A9 teto-rodadas-tool', async () => { globalThis.__script = () => ({ok:true, toolCalls:[{id:'1',type:'function',function:{name:'consultar_calendario',arguments:'{}'}}]});
  let threw=false; try { await turn(H('x')); } catch { threw=true; } ok(threw && globalThis.__calls<=8, 'calls='+globalThis.__calls+' threw='+threw); });
await t('AC-A10 max-2-bolhas', async () => { globalThis.__script = () => reply({...base, mensagens:['a','b','c']});
  const r = await turn(H('x')); ok(r.mensagens.length<=2, 'len='+r.mensagens.length); });
await t('AC-A11 json-sem-mensagens-falha-alto', async () => { globalThis.__script = () => reply({data:'2026-09-18'});
  let threw=false; try { await turn(H('x')); } catch { threw=true; } ok(threw, 'shape errado passou em silencio'); });
await t('T12 payload-tools-sem-response-format', async () => { let opts1; globalThis.__script = (n, msgs, opts) => { if (n===1) opts1 = opts; return reply(base); };
  await turn(H('oi')); ok(!!opts1 && !!opts1.tools && !opts1.response_format, 'response_format enviado junto com tools: '+JSON.stringify(opts1)); });
await t('T12 tool_use_failed-nao-vira-legado', async () => { globalThis.__script = (n) => (n<=2 ? {ok:false, status:400, code:'tool_use_failed', error:'tool call failed'} : reply(base));
  const r = await turn(H('oi')); ok(!!r && Array.isArray(r.mensagens), 'nao completou o turno apos tool_use_failed: '+JSON.stringify(r)); });
await t('T12 nao-suporta-tools-vira-erro-distinto', async () => { globalThis.__script = () => ({ok:false, status:400, code:'model_not_found', error:'This model does not support function calling'});
  let erro=null; try { await turn(H('oi')); } catch (e) { erro=e; } ok(erro instanceof b.ModeloSemToolsError, 'nao lancou ModeloSemToolsError: '+String(erro)); });
await t('T12 formatacao-nao-fura-o-teto', async () => { globalThis.__script = (n) => (n % 4 === 0)
    ? reply({data:'sem mensagens'})
    : {ok:true, toolCalls:[{id:'1',type:'function',function:{name:'consultar_calendario',arguments:'{}'}}]};
  let threw=false; try { await turn(H('x')); } catch { threw=true; } ok(threw && globalThis.__calls<=8, 'calls='+globalThis.__calls+' threw='+threw); });
console.log(JSON.stringify(res));

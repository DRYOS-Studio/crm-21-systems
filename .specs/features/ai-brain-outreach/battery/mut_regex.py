# Mutações de ligação de regex (M14/M15/M16): cada uma liga uma regex "plausível" no runBrainTurn.
import sys
p, mode = sys.argv[1], sys.argv[2]
s = open(p).read()
JANELA = '(() => { const i = historyMessages.map((m) => m.role).lastIndexOf("assistant"); return historyMessages.slice(i + 1).filter((m) => m.role === "user").map((m) => m.content).join("\\n"); })()'
HIST = 'historyMessages.filter((m) => m.role === "user").map((m) => m.content).join("\\n")'
# edição mínima: original sem os 3 padrões mortos pelo corpus r2, + frases do corpus positivo
MINIMA = r'''[/^\s*(pare|para|parar)\s*[.!]*\s*$/i, /\bpare de\b/i, /\bpara de me\b/i, /n[aã]o quero mais receber/i, /n[aã]o tenho interesse/i,
    /n[aã]o me (mand|manda|envi)/i, /me tira/i, /tira meu/i, /sai(r)? da lista/i, /descadastr/i,
    /remover? (meu|da lista)/i, /\bstop\b/i, /vou bloquear/i, /vou denunciar/i, /\bdenuncio\b/i, /\bspam\b/i,
    /perde(u|r) meu tempo/i, /n[aã]o perturbe/i]'''
fn = 'function __sair(t: string) { return %s.some((r) => r.test(t)); }\n' % MINIMA
if mode == 'M14':   texto, det = JANELA, '__sair'
elif mode == 'M15': texto, det = HIST, '__sair'
elif mode == 'M16': texto, det = JANELA, 'pediuHumano'
a = 'optout: r.optout === true,'
if mode in ('M14','M15'):
    b = 'optout: r.optout === true || %s(%s),' % (det, texto)
else:
    a = 'const precisaEscalar = r.escalar === true || confirmacoes >= 2;'
    b = 'const precisaEscalar = r.escalar === true || confirmacoes >= 2 || pediuHumano(%s);' % texto
assert s.count(a) == 1, 'mutacao nao aplicou'
s = s.replace(a, b) + '\n' + fn
open(p, 'w').write(s)

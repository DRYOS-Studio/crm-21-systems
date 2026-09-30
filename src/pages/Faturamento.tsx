import { AlertCircle, CheckCircle2, Clock3, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBillingAccess } from "@/hooks/useBillingAccess";

export default function Faturamento() {
  const billing = useBillingAccess();
  const blocked = !billing.allowed && billing.status !== "unavailable";
  const inGrace = billing.status === "past_due" && billing.allowed;

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          {billing.allowed
            ? <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            : blocked
              ? <AlertCircle className="h-6 w-6 text-destructive" />
              : <Clock3 className="h-6 w-6 text-muted-foreground" />}
          <h1 className="text-xl font-semibold">Faturamento Q7</h1>
        </div>

        {billing.loading ? (
          <p className="mt-5 text-sm text-muted-foreground">Consultando o status da instalação…</p>
        ) : !billing.fresh ? (
          <p className="mt-5 text-sm text-muted-foreground">
            Não foi possível confirmar a cobrança agora. O acesso será liberado assim que a sincronização voltar.
          </p>
        ) : billing.allowed ? (
          <div className="mt-5 space-y-3 text-sm">
            <p>{inGrace ? "Pagamento em atraso. O acesso continua liberado durante o prazo de regularização." : "Assinatura em dia."}</p>
            {inGrace && billing.graceEndsAt && <p>Prazo para regularização: {new Date(billing.graceEndsAt).toLocaleString("pt-BR")}.</p>}
          </div>
        ) : (
          <div className="mt-5 space-y-3 text-sm">
            <p>O acesso ao Q7 está pausado por pendência de pagamento. As mensagens recebidas continuam sendo armazenadas.</p>
            {billing.status === "past_due" && billing.graceEndsAt && <p>Prazo de regularização encerrado em {new Date(billing.graceEndsAt).toLocaleString("pt-BR")}.</p>}
          </div>
        )}

        {billing.paymentUrl && (
          <Button className="mt-5" asChild>
            <a href={billing.paymentUrl} target="_blank" rel="noreferrer">
              Abrir cobrança <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        )}

        <div className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
          <p>Precisa de suporte? Peça ajuda ao administrador da sua empresa.</p>
        </div>
      </section>
    </main>
  );
}

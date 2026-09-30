import { useMemberAccess } from "@/hooks/useMemberAccess";

export function ProtectedModuleRoute({ module, children }: { module: string; children: React.ReactNode }) {
  const { hasModule, loading } = useMemberAccess();
  if (loading) return <div className="min-h-[50vh] grid place-items-center text-sm text-muted-foreground">Carregando permissões…</div>;
  if (!hasModule(module)) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Acesso não concedido</h1>
          <p className="mt-2 text-sm text-muted-foreground">Peça ao administrador da empresa para liberar este módulo e os dispositivos necessários.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

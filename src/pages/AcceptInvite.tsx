import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AcceptInvite() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use uma senha com pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError("O link expirou ou não pode ser usado. Peça ao admin para enviar outro.");
      return;
    }
    await signOut();
    navigate("/login", { replace: true });
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Validando convite…</div>;

  return (
    <main className="min-h-screen grid place-items-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Ativar acesso</h1>
          <p className="mt-1 text-sm text-muted-foreground">Defina sua senha para entrar no Q7 Pipeline.</p>
        </div>
        {session ? <>
          <div className="space-y-2">
            <Label htmlFor="invite-password">Nova senha</Label>
            <Input id="invite-password" type="password" minLength={8} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-confirm">Confirmar senha</Label>
            <Input id="invite-confirm" type="password" minLength={8} autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>{saving ? "Salvando…" : "Definir senha"}</Button>
        </> : <>
          <p className="text-sm text-muted-foreground">Este link expirou ou já foi usado. Peça ao administrador para enviar um novo link.</p>
          <Button type="button" variant="outline" className="w-full" onClick={() => navigate("/login", { replace: true })}>Voltar ao login</Button>
        </>}
      </form>
    </main>
  );
}

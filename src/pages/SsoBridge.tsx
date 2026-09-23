import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Recebe access_token/refresh_token de outro app DRYOS que compartilha este
// mesmo projeto Supabase (ex: o Extrator) e loga o usuário aqui sem senha.
export default function SsoBridge() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    window.history.replaceState(null, "", window.location.pathname);

    if (!access_token || !refresh_token) {
      setError("Link de acesso inválido ou expirado.");
      return;
    }
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) setError(error.message);
      else navigate("/", { replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      {error ? (
        <div className="text-center space-y-2">
          <p className="text-destructive text-sm">{error}</p>
          <a href="/login" className="text-primary underline text-sm">Ir para o login</a>
        </div>
      ) : (
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  );
}

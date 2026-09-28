import { Plug } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UazapiConnectionPanel } from "@/components/uazapi/UazapiConnectionPanel";

export default function UazapiConfig() {
  const navigate = useNavigate();

  return (
    <div className="dryos min-h-screen bg-background text-foreground p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="w-6 h-6 text-primary" /> WhatsApp / Uazapi
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cada conta conecta o próprio WhatsApp: Server URL, tokens, webhook e QR.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conexão</CardTitle>
          </CardHeader>
          <CardContent>
            <UazapiConnectionPanel />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

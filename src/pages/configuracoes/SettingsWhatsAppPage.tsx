import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UazapiConnectionPanel } from "@/components/uazapi/UazapiConnectionPanel";

export default function SettingsWhatsAppPage() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Conexão WhatsApp</CardTitle>
      </CardHeader>
      <CardContent>
        <UazapiConnectionPanel />
      </CardContent>
    </Card>
  );
}

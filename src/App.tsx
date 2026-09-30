import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import SsoBridge from "./pages/SsoBridge";
import Conversas from "./pages/Conversas";
import Kanban from "./pages/Kanban";
import Prospeccao from "./pages/Prospeccao";
import NotFound from "./pages/NotFound";
import SettingsLayout, { SettingsIndexRedirect } from "./pages/configuracoes/SettingsLayout";
import SettingsWhatsAppPage from "./pages/configuracoes/SettingsWhatsAppPage";
import SettingsNegocioPage from "./pages/configuracoes/SettingsNegocioPage";
import SettingsAgentePage from "./pages/configuracoes/SettingsAgentePage";
import SettingsConhecimentoPage from "./pages/configuracoes/SettingsConhecimentoPage";
import SettingsCrmPage from "./pages/configuracoes/SettingsCrmPage";
import SettingsCamposPage from "./pages/configuracoes/SettingsCamposPage";
import SettingsMarcaPage from "./pages/configuracoes/SettingsMarcaPage";
import SettingsInstalacoesPage from "./pages/configuracoes/SettingsInstalacoesPage";
import { AdminRoute } from "./components/admin/AdminRoute";
import Agenda from "./pages/Agenda";
import Dashboard from "./pages/Dashboard";
import Faturamento from "./pages/Faturamento";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/sso" element={<SsoBridge />} />
            <Route path="/faturamento" element={<Navigate to="/configuracoes/faturamento" replace />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/conversas" element={<ProtectedRoute><Conversas /></ProtectedRoute>} />
            <Route path="/crm" element={<ProtectedRoute><Kanban /></ProtectedRoute>} />
            <Route path="/kanban" element={<Navigate to="/crm" replace />} />
            <Route path="/prospeccao" element={<ProtectedRoute><Prospeccao /></ProtectedRoute>} />
            <Route path="/agenda" element={<ProtectedRoute><Agenda /></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute><SettingsLayout /></ProtectedRoute>}>
              <Route index element={<SettingsIndexRedirect />} />
              <Route path="whatsapp" element={<SettingsWhatsAppPage />} />
              <Route path="faturamento" element={<Faturamento />} />
              <Route path="negocio" element={<SettingsNegocioPage />} />
              <Route path="agente" element={<SettingsAgentePage />} />
              <Route path="conhecimento" element={<SettingsConhecimentoPage />} />
              <Route path="crm" element={<SettingsCrmPage />} />
              <Route path="campos" element={<SettingsCamposPage />} />
              <Route path="marca" element={<AdminRoute><SettingsMarcaPage /></AdminRoute>} />
              <Route path="instalacoes" element={<AdminRoute><SettingsInstalacoesPage /></AdminRoute>} />
            </Route>
            <Route path="/whatsapp" element={<Navigate to="/configuracoes/whatsapp" replace />} />
            <Route path="/admin/uazapi" element={<Navigate to="/configuracoes/whatsapp" replace />} />
            <Route path="/agente" element={<Navigate to="/" replace />} />
            <Route path="/conectar" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

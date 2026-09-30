import { Navigate, Route, Routes } from 'react-router-dom'
import { OperationProvider } from './context/OperationContext.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'
import Layout from './components/Layout.jsx'
import RouteGuard from './components/RouteGuard.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Competitors from './pages/Competitors.jsx'
import CompetitorDetail from './pages/CompetitorDetail.jsx'
import Products from './pages/Products.jsx'
import HotProducts from './pages/HotProducts.jsx'
import EstoqueFornecedor from './pages/EstoqueFornecedor.jsx'
import Ads from './pages/Ads.jsx'
import AdMiner from './pages/AdMiner.jsx'
import Alerts from './pages/Alerts.jsx'
import BuscarBarcode from './pages/BuscarBarcode.jsx'
import EspionarLoja from './pages/EspionarLoja.jsx'
import Historico from './pages/Historico.jsx'
import Usuarios from './pages/Usuarios.jsx'
import Organizacoes from './pages/Organizacoes.jsx'
import Afiliados from './pages/Afiliados.jsx'
import Indicacao from './pages/Indicacao.jsx'
import AdminIndicacoes from './pages/AdminIndicacoes.jsx'
import Comunidade from './pages/Comunidade.jsx'
import AdminComunidades from './pages/AdminComunidades.jsx'
import AdminSugestoes from './pages/AdminSugestoes.jsx'
import Conta from './pages/Conta.jsx'
import Suporte from './pages/Suporte.jsx'
import MeuPainel from './pages/MeuPainel.jsx'
import AdminAfiliadoPainel from './pages/AdminAfiliadoPainel.jsx'

// Quem não tem acesso ao núcleo do ScoutX não deve cair numa tela de "sem
// permissão" logo depois de logar — manda direto pra ferramenta que ela
// sempre pôde usar (Buscar Barcode), em vez do Dashboard. Afiliado (pedido
// do usuário, 2026-09-29) nem tem essa ferramenta — só existe "Meu Painel".
function Home() {
  const { me, loading } = useAuth()
  if (loading || !me) return null
  if (me.isAffiliate) return <Navigate to="/meu-painel" replace />
  if (me.isAdmin || me.canAccessMinerador) return <Dashboard />
  return <Navigate to="/ferramentas/buscar-barcode" replace />
}

// Radar de Vendas: ainda em desenvolvimento, só abre no servidor local
// (me.radarEnabled, ver server.js). Em produção o endereço volta pro início.
function RadarGate() {
  const { me, loading } = useAuth()
  if (loading || !me) return null
  if (!me.radarEnabled) return <Navigate to="/" replace />
  return <EstoqueFornecedor />
}

export default function App() {
  return (
    <ThemeProvider>
    <LanguageProvider>
    <AuthProvider>
      <OperationProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />

            {/* Núcleo do ScoutX — mesma permissão (isAdmin || canAccessMinerador) que
                já protegia essas telas em /minerador antes da fusão dos apps. */}
            <Route element={<RouteGuard allow={(me) => me.isAdmin || me.canAccessMinerador} />}>
              <Route path="/concorrentes" element={<Competitors />} />
              <Route path="/concorrentes/:id" element={<CompetitorDetail />} />
              <Route path="/produtos" element={<Products />} />
              <Route path="/produtos-quentes" element={<HotProducts />} />
              <Route path="/radar-vendas" element={<RadarGate />} />
              <Route path="/anuncios" element={<Ads />} />
              <Route path="/minerador-de-anuncios" element={<AdMiner />} />
              <Route path="/alertas" element={<Alerts />} />
            </Route>

            {/* Meu Painel: qualquer conta logada cujo email bata com um
                afiliado cadastrado acessa (me.affiliateId) — pedido do
                usuário, 2026-09-29. me.isAffiliate (conta dedicada, sem
                outro acesso) continua isolado nas rotas abaixo. */}
            <Route element={<RouteGuard allow={(me) => !!me.affiliateId} />}>
              <Route path="/meu-painel" element={<MeuPainel />} />
            </Route>

            {/* Buscar Barcode / Espionar Loja: qualquer usuário logado sempre pôde
                usar (nunca tiveram permissão extra) — sem guard aqui de propósito.
                Exceto afiliado, que só vê o próprio painel. */}
            <Route element={<RouteGuard allow={(me) => !me.isAffiliate} />}>
              <Route path="/ferramentas/buscar-barcode" element={<BuscarBarcode />} />
              <Route path="/ferramentas/espionar-loja" element={<EspionarLoja />} />
            </Route>

            {/* Minha Conta: idioma, senha, notificação Discord — configuração
                da PESSOA, não da ferramenta, então qualquer usuário logado
                acessa, sem RouteGuard de permissão. */}
            <Route path="/conta" element={<Conta />} />

            {/* Suporte (WhatsApp): mesma lógica de Minha Conta — não é
                permissão de ferramenta, qualquer pessoa logada precisa
                conseguir pedir ajuda. */}
            <Route path="/suporte" element={<Suporte />} />

            {/* Indicação: cliente indica cliente, self-service — qualquer
                usuário logado acessa, mesma lógica de Suporte/Minha Conta.
                Comunidade de Embaixadores continua desativada (não pedida
                ainda), rotas dela removidas por completo do frontend. */}
            <Route element={<RouteGuard allow={(me) => !me.isAffiliate} />}>
              <Route path="/indicacao" element={<Indicacao />} />
            </Route>

            {/* Comunidade de Embaixadores: qualquer usuário logado acessa; o
                que cada um vê/pode fazer (embaixador, membro, quem ainda não
                entrou) é decidido dentro da própria tela, não por RouteGuard. */}
            <Route path="/comunidade" element={<Comunidade />} />

            <Route element={<RouteGuard allow={(me) => me.isAdmin} />}>
              <Route path="/ferramentas/historico" element={<Historico />} />
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/organizacoes" element={<Organizacoes />} />
              <Route path="/afiliados" element={<Afiliados />} />
              <Route path="/afiliados/:id/painel" element={<AdminAfiliadoPainel />} />
              <Route path="/admin/indicacoes" element={<AdminIndicacoes />} />
              <Route path="/admin/comunidades" element={<AdminComunidades />} />
              <Route path="/admin/sugestoes" element={<AdminSugestoes />} />
            </Route>

            {/* Endereço que não existe (link antigo, digitado errado): volta pro
                início em vez de ficar com a tela preta. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </OperationProvider>
    </AuthProvider>
    </LanguageProvider>
    </ThemeProvider>
  )
}

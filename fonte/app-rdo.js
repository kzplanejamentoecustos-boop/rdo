/* ===== app.js ===== */
/* =============================================================================
   RDO — Relatorio Diario de Obra (CTC / KZ) — app.js
   Versao: 1.0.0

   Construido sobre a mesma biblioteca do Controle de Execucao em Campo
   (CTC App Standard 1.7 + acesso-kz.js do Portal KZ): visual do Controle de
   Custos, login do Portal KZ e nuvem por obra.

   1.3.0: varias pessoas no mesmo relatorio: antes de enviar, junta a nuvem com o aparelho item por
          item (cada linha de efetivo, equipamento, atividade, ocorrencia, material, visita e foto,
          cada turno do clima, cada campo do horario e cada campo simples), numa transacao; vale a
          ultima alteracao so quando duas pessoas mexem no mesmo item. Busca o que os outros lancaram a
          cada minuto. Iniciais de quem esta com o RDO aberto no cabecalho (como no Excel).
   1.2.0: aprovadores definidos no Portal KZ aparecem travados na Configuracao (com cadeado);
          caixa de aprovacao da folha mostra "Aguardando voce" para o aprovador da vez.
   1.1.0: visual no modelo do Diario de Obra: visao geral com foto da obra, contadores,
          relatorios e fotos recentes; lista com legenda e etiquetas cheias (Preenchendo /
          Revisar / Aprovado); relatorio em formato de folha (logos, quadro de prazos, horario,
          clima e indice pluviometrico, mao de obra e equipamentos em grade, atividades com as
          fotos ligadas, galeria, 1a e 2a aprovacao, anterior/proximo, criado por / ultima
          modificacao, log de edicoes); edicao em pagina propria; logos, foto da obra, codigo do
          relatorio e cargos dos aprovadores na configuracao; foto ligada a uma atividade.
   1.0.0: primeira versao.
          - Um RDO por dia e por obra: cabecalho (dia X de Y do prazo), clima por turno
            (manha / tarde / noite) com link do mapa de chuva da obra, horario de trabalho,
            efetivo (proprio e terceiros, presenca, meio dia, homem-hora), equipamentos,
            atividades, ocorrencias, materiais recebidos, visitas, fotos com data e hora
            gravadas na imagem, comentarios, adendos e historico.
          - "Copiar do dia anterior" (efetivo, equipamentos e atividades nao concluidas).
          - Fluxo: Rascunho -> Enviado -> Aprovado pela contratada -> Aprovado (contratante).
            Recusa com motivo volta para correcao. Depois da 1a aprovacao ninguem edita:
            so adendos (acrescentam texto, nunca apagam).
          - Aprovadores (um da contratada e um da contratante) pelo e-mail cadastrado no
            Portal KZ, no controle RDO da obra (obra.controles[rdo].aprovadores).
          - PDF do RDO (completo ou sem fotos) e PDF do periodo; Excel do efetivo / homem-hora.
          - Painel: prazo, calendario por situacao, mapa de chuva, histograma de efetivo.
          - Funciona sem internet: tudo fica neste aparelho e vai para a nuvem quando
            houver sinal.
          - Demonstracao com dados ficticios (sem nuvem) para treinar e testar.

   ESTRUTURA NA NUVEM (regras do Portal KZ: obras/{obra}/{controle}/...)
     obras/{obra}/{controle}/config                 configuracao e cadastros da obra
     obras/{obra}/{controle}/rdo-AAAA-MM-DD         um RDO (sem as fotos)
     obras/{obra}/{controle}/rdo-AAAA-MM-DD/fotos/{id}   uma foto (JPEG em data URL)

   ESTRUTURA DESTE ARQUIVO
   00. Configuracao, acesso e estado
   01. Catalogos (opcoes dos campos e secoes do RDO)
   02. Utilitarios de datas e calculos
   03. Armazenamento neste aparelho (IndexedDB) e nuvem
   04. Carregamento e sincronizacao
   05. Regras do RDO (criar, copiar, editar, enviar, aprovar, recusar, adendo)
   06. Fotos
   07. Paginas
   08. PDF
   09. Demonstracao (dados ficticios)
   10. Tela de entrada e montagem do aplicativo
   ========================================================================== */


/* =============================================================================
   00. CONFIGURACAO, ACESSO E ESTADO
   ========================================================================== */

const VERSAO_RDO = '1.3.0';
const NOME_CONTROLE_KZ = 'RDO — Relatório Diário de Obra';
const LINK_CONTROLE_KZ = 'rdo';            // trecho do link do controle cadastrado no Portal (…/rdo/)
const MARCA = { logo: 'CTC', titulo: 'RDO — Relatório Diário de Obra' };
const LIMITE_FOTOS = 30;

const FIREBASE_KZ = {
  apiKey: 'AIzaSyCk1hdv3h8A2gDOcaZDRuRtceDiG2bvXOc',
  authDomain: 'kz-planejamento-e-custos.firebaseapp.com',
  projectId: 'kz-planejamento-e-custos',
  storageBucket: 'kz-planejamento-e-custos.firebasestorage.app',
  messagingSenderId: '755715307647',
  appId: '1:755715307647:web:6573d0437b23b880bae74a',
};

const NOME_PERFIL = { visualizador: 'Visualizador', controlador: 'Controlador', administrador: 'Administrador' };
const PERFIL_DO_PAPEL = { leitor: 'visualizador', editor: 'controlador', admin: 'administrador' };

/** Estado geral do aplicativo. */
const estado = {
  modo: 'nuvem',                 // 'nuvem' | 'demo'
  obra: null,                    // { id, nome, sigla }
  controle: LINK_CONTROLE_KZ,    // codigo do controle na obra (descoberto pelo link no Portal)
  usuario: null,                 // { email, nome, papel }
  perfil: 'visualizador',
  aprovadores: { contratada: '', contratante: '' },
  aprovadoresDoPortal: false,
  config: null,
  rdos: new Map(),               // id -> rdo
  pendentes: new Set(),          // ids de RDO com alteracao ainda nao enviada a nuvem
  fotosPendentes: new Set(),     // chaves rdoId|fotoId ainda nao enviadas
  configPendente: false,
  sync: { ultimo: null, erro: null, rodando: false },
};
const ui = { rdoAberto: null, mesPainel: null, visaoCalendario: 'situacao' };
let aplicativo = null;
let obraUrl = KZ.obraDaUrl();

const ehDemo = () => estado.modo === 'demo';
const podeEditarPerfil = () => ['controlador', 'administrador'].includes(estado.perfil);
const ehAdministrador = () => estado.perfil === 'administrador';
const meuEmail = () => String((estado.usuario || {}).email || '').trim().toLowerCase();
const meuNome = () => (estado.usuario ? estado.usuario.nome : 'Usuário');
const souAprovador = (lado) => Boolean(meuEmail()) && meuEmail() === String(estado.aprovadores[lado] || '').trim().toLowerCase();


/* =============================================================================
   01. CATALOGOS
   ========================================================================== */

const TEMPOS = ['Bom', 'Nublado', 'Chuva fraca', 'Chuva forte', 'Não trabalhado'];
const CONDICOES = ['Praticável', 'Impraticável'];
const TURNOS = [{ chave: 'manha', texto: 'Manhã' }, { chave: 'tarde', texto: 'Tarde' }, { chave: 'noite', texto: 'Noite' }];
const PRESENCAS = ['Presente', 'Falta', 'Atestado', 'Férias', 'Treinamento', 'Folga'];
const FRACOES = [{ valor: '1', texto: 'Dia inteiro' }, { valor: '0.5', texto: 'Meio dia' }];
const SITUACOES_EQUIP = ['Trabalhando', 'Parado', 'Em manutenção', 'À disposição'];
const PROPRIEDADES = ['Próprio', 'Locado', 'De terceiro'];
const SITUACOES_ATIV = ['Iniciada', 'Em andamento', 'Concluída', 'Paralisada'];
const TIPOS_OCORRENCIA = ['Acidente / incidente', 'Interferência', 'Falta de material', 'Falta de mão de obra', 'Falta de equipamento', 'Chuva', 'Pedido / pendência do cliente', 'Mudança de projeto', 'Fiscalização', 'Outro'];
const IMPACTOS = ['Sem impacto', 'Atraso', 'Paralisação parcial', 'Paralisação total'];

const STATUS_RDO = {
  rascunho: { texto: 'Preenchendo relatório', curto: 'Preenchendo', badge: 'warning', linha: undefined },
  enviado: { texto: 'Revisar · aguardando a 1ª aprovação (contratada)', curto: 'Revisar (1ª)', badge: 'danger', linha: undefined },
  'em-aprovacao': { texto: 'Revisar · aguardando a 2ª aprovação (contratante)', curto: 'Revisar (2ª)', badge: 'danger', linha: undefined },
  aprovado: { texto: 'Aprovado', curto: 'Aprovado', badge: 'success', linha: undefined },
  recusado: { texto: 'Devolvido para correção', curto: 'Devolvido', badge: 'info', linha: undefined },
};
const STATUS_TRAVADOS = ['em-aprovacao', 'aprovado'];

/** Blocos do RDO (cada obra pode ocultar os que nao usa). */
const BLOCOS = [
  { id: 'clima', texto: 'Clima e condição de trabalho', fixo: true },
  { id: 'horario', texto: 'Horário de trabalho' },
  { id: 'efetivo', texto: 'Efetivo (mão de obra)' },
  { id: 'equipamentos', texto: 'Equipamentos' },
  { id: 'atividades', texto: 'Atividades executadas', fixo: true },
  { id: 'ocorrencias', texto: 'Ocorrências' },
  { id: 'materiais', texto: 'Materiais recebidos' },
  { id: 'visitas', texto: 'Visitas e fiscalização' },
  { id: 'fotos', texto: 'Fotos' },
  { id: 'comentarios', texto: 'Comentários' },
];
const blocoVisivel = (id) => !((estado.config || {}).blocosOcultos || []).includes(id);

/**
 * Secoes em lista do RDO (efetivo, equipamentos...). Cada uma define os campos do
 * formulario (criarCampo), as colunas da tabela e as colunas do PDF.
 * "cadastro" liga o campo a uma lista de sugestoes da configuracao da obra.
 */
const SECOES_LISTA = {
  efetivo: {
    titulo: 'Efetivo (mão de obra)', icone: 'usuario', item: 'pessoa / função',
    campos: [
      { nome: 'empresa', rotulo: 'Empresa', cadastro: 'empresas', obrigatorio: true, dica: 'Própria ou terceirizada' },
      { nome: 'funcao', rotulo: 'Função', cadastro: 'funcoes', obrigatorio: true },
      { nome: 'nome', rotulo: 'Nome (opcional)', cadastro: 'colaboradores', dica: 'Deixe em branco para lançar só a quantidade da função' },
      { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'numero', obrigatorio: true, regras: { minimo: 0, maximo: 999 } },
      { nome: 'presenca', rotulo: 'Presença', tipo: 'select', opcoes: PRESENCAS, obrigatorio: true },
      { nome: 'fracao', rotulo: 'Jornada', tipo: 'select', opcoes: FRACOES, obrigatorio: true },
      { nome: 'horas', rotulo: 'Horas trabalhadas (opcional)', tipo: 'numero', dica: 'Em branco = jornada do horário de trabalho', regras: { minimo: 0, maximo: 24 } },
    ],
    novo: () => ({ empresa: (estado.config.cadastros.empresas[0] || ''), quantidade: 1, presenca: 'Presente', fracao: '1' }),
    colunas: [
      { campo: 'empresa', titulo: 'Empresa' },
      { campo: 'funcao', titulo: 'Função' },
      { campo: 'nome', titulo: 'Nome' },
      { campo: 'quantidade', titulo: 'Qtd.', tipo: 'numero', casas: 0, total: 'soma' },
      { campo: 'presenca', titulo: 'Presença' },
      { campo: 'jornada', titulo: 'Jornada' },
      { campo: 'hh', titulo: 'Homem-hora', tipo: 'numero', casas: 1, total: 'soma' },
    ],
    linhaTabela: (l, rdo) => ({ ...l, jornada: Number(l.fracao) === 0.5 ? 'Meio dia' : 'Dia inteiro', hh: homemHoraLinha(l, rdo) }),
  },
  equipamentos: {
    titulo: 'Equipamentos', icone: 'configuracao', item: 'equipamento',
    campos: [
      { nome: 'equipamento', rotulo: 'Equipamento', cadastro: 'equipamentos', obrigatorio: true },
      { nome: 'propriedade', rotulo: 'Propriedade', tipo: 'select', opcoes: PROPRIEDADES, obrigatorio: true },
      { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'numero', obrigatorio: true, regras: { minimo: 0, maximo: 999 } },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: SITUACOES_EQUIP, obrigatorio: true },
      { nome: 'horas', rotulo: 'Horas de uso', tipo: 'numero', regras: { minimo: 0, maximo: 24 } },
      { nome: 'obs', rotulo: 'Observação', larguraTotal: true },
    ],
    novo: () => ({ propriedade: 'Próprio', quantidade: 1, situacao: 'Trabalhando' }),
    colunas: [
      { campo: 'equipamento', titulo: 'Equipamento' },
      { campo: 'propriedade', titulo: 'Propriedade' },
      { campo: 'quantidade', titulo: 'Qtd.', tipo: 'numero', casas: 0, total: 'soma' },
      { campo: 'situacao', titulo: 'Situação' },
      { campo: 'horas', titulo: 'Horas', tipo: 'numero', casas: 1 },
      { campo: 'obs', titulo: 'Observação' },
    ],
  },
  atividades: {
    titulo: 'Atividades executadas', icone: 'check', item: 'atividade',
    campos: [
      { nome: 'servico', rotulo: 'Serviço / atividade', cadastro: 'servicos', obrigatorio: true, larguraTotal: true },
      { nome: 'local', rotulo: 'Local / frente', cadastro: 'locais' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: SITUACOES_ATIV, obrigatorio: true },
      { nome: 'quantidade', rotulo: 'Quantidade executada no dia', tipo: 'numero', regras: { minimo: 0 } },
      { nome: 'unidade', rotulo: 'Unidade', cadastro: 'unidades', dica: 'm³, m², m, un, kg…' },
      { nome: 'avanco', rotulo: 'Avanço acumulado (%)', tipo: 'percentual', regras: { minimo: 0, maximo: 100 } },
      { nome: 'pessoas', rotulo: 'Pessoas na atividade', tipo: 'numero', regras: { minimo: 0, maximo: 999 } },
      { nome: 'obs', rotulo: 'Observação', tipo: 'textarea', larguraTotal: true },
    ],
    novo: () => ({ situacao: 'Em andamento' }),
    colunas: [
      { campo: 'servico', titulo: 'Serviço' },
      { campo: 'local', titulo: 'Local' },
      { campo: 'situacao', titulo: 'Situação' },
      { campo: 'qtdTexto', titulo: 'Qtd. no dia' },
      { campo: 'avanco', titulo: 'Avanço', tipo: 'percentual', casas: 0 },
      { campo: 'obs', titulo: 'Observação' },
    ],
    linhaTabela: (l) => ({ ...l, qtdTexto: temValor(l.quantidade) ? `${formatarNumero(l.quantidade, 2)} ${l.unidade || ''}`.trim() : '—' }),
  },
  ocorrencias: {
    titulo: 'Ocorrências', icone: 'alerta', item: 'ocorrência',
    campos: [
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_OCORRENCIA, obrigatorio: true },
      { nome: 'impacto', rotulo: 'Impacto', tipo: 'select', opcoes: IMPACTOS, obrigatorio: true },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea', obrigatorio: true, larguraTotal: true },
      { nome: 'responsavel', rotulo: 'Quem pediu / responsável', larguraTotal: true },
    ],
    novo: () => ({ tipo: 'Interferência', impacto: 'Sem impacto' }),
    colunas: [
      { campo: 'tipo', titulo: 'Tipo' },
      { campo: 'impacto', titulo: 'Impacto' },
      { campo: 'descricao', titulo: 'Descrição' },
      { campo: 'responsavel', titulo: 'Responsável' },
    ],
  },
  materiais: {
    titulo: 'Materiais recebidos', icone: 'download', item: 'material',
    campos: [
      { nome: 'material', rotulo: 'Material', obrigatorio: true, larguraTotal: true },
      { nome: 'quantidade', rotulo: 'Quantidade', tipo: 'numero', regras: { minimo: 0 } },
      { nome: 'unidade', rotulo: 'Unidade', cadastro: 'unidades' },
      { nome: 'fornecedor', rotulo: 'Fornecedor', cadastro: 'empresas' },
      { nome: 'documento', rotulo: 'Nota fiscal / romaneio' },
    ],
    novo: () => ({}),
    colunas: [
      { campo: 'material', titulo: 'Material' },
      { campo: 'qtdTexto', titulo: 'Quantidade' },
      { campo: 'fornecedor', titulo: 'Fornecedor' },
      { campo: 'documento', titulo: 'NF / romaneio' },
    ],
    linhaTabela: (l) => ({ ...l, qtdTexto: temValor(l.quantidade) ? `${formatarNumero(l.quantidade, 2)} ${l.unidade || ''}`.trim() : '—' }),
  },
  visitas: {
    titulo: 'Visitas e fiscalização', icone: 'olho', item: 'visita',
    campos: [
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
      { nome: 'empresa', rotulo: 'Empresa / órgão', cadastro: 'empresas' },
      { nome: 'horario', rotulo: 'Horário (HH:MM)', placeholder: '09:30', regras: { validar: validarHora } },
      { nome: 'motivo', rotulo: 'Motivo / observação', tipo: 'textarea', larguraTotal: true },
    ],
    novo: () => ({}),
    colunas: [
      { campo: 'nome', titulo: 'Nome' },
      { campo: 'empresa', titulo: 'Empresa' },
      { campo: 'horario', titulo: 'Horário' },
      { campo: 'motivo', titulo: 'Motivo' },
    ],
  },
};

/** Cadastros da obra (sugestoes dos campos). */
const CADASTROS = [
  { id: 'empresas', texto: 'Empresas (própria e terceirizadas)', exemplo: 'CTC Infra' },
  { id: 'funcoes', texto: 'Funções', exemplo: 'Pedreiro' },
  { id: 'colaboradores', texto: 'Colaboradores (nomes)', exemplo: 'Nome do colaborador' },
  { id: 'equipamentos', texto: 'Equipamentos', exemplo: 'Retroescavadeira' },
  { id: 'servicos', texto: 'Serviços / atividades', exemplo: 'Concretagem de bloco' },
  { id: 'locais', texto: 'Locais / frentes', exemplo: 'Bloco B1' },
  { id: 'unidades', texto: 'Unidades', exemplo: 'm³' },
];
const UNIDADES_PADRAO = ['m³', 'm²', 'm', 'un', 'kg', 't', 'vb', 'h', '%'];

function configVazia() {
  return {
    contrato: '', cliente: '', contratada: 'CTC Infra', endereco: '', responsavel: '',
    inicio: '', prazoDias: null, linkChuva: '',
    horaInicio: '07:00', horaFim: '17:00', intervaloMin: 60,
    blocosOcultos: [],
    aprovadoresProvisorios: { contratada: '', contratante: '' },
    logos: { contratante: '', contratada: '', outra: '' }, capa: '', codigoDocumento: '', cargos: { contratada: '', contratante: '' },
    cadastros: { empresas: ['CTC Infra'], funcoes: [], colaboradores: [], equipamentos: [], servicos: [], locais: [], unidades: [...UNIDADES_PADRAO] },
  };
}
function normalizarConfig(c) {
  const base = configVazia();
  const final = { ...base, ...(c || {}) };
  final.cadastros = { ...base.cadastros, ...((c || {}).cadastros || {}) };
  final.aprovadoresProvisorios = { ...base.aprovadoresProvisorios, ...((c || {}).aprovadoresProvisorios || {}) };
  final.blocosOcultos = Array.isArray(final.blocosOcultos) ? final.blocosOcultos : [];
  final.logos = { ...base.logos, ...((c || {}).logos || {}) };
  final.cargos = { ...base.cargos, ...((c || {}).cargos || {}) };
  return final;
}


/* =============================================================================
   02. UTILITARIOS DE DATAS E CALCULOS
   ========================================================================== */

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const temValor = (v) => v !== null && v !== undefined && v !== '';
const num = (v) => (typeof v === 'number' ? v : (paraNumero(v) ?? 0));
const hojeIso = () => formatarData(new Date(), 'iso');
const agoraIso = () => new Date().toISOString();
const idRdo = (dataIso) => `rdo-${dataIso}`;
const dataDoId = (id) => String(id).replace(/^rdo-/, '');
const diaSemana = (iso) => { const d = paraData(iso); return d ? DIAS_SEMANA[d.getDay()] : ''; };
const dataLonga = (iso) => `${formatarData(iso)} (${diaSemana(iso)})`;
const copiaProfunda = (o) => JSON.parse(JSON.stringify(o ?? null));

function validarHora(v) {
  if (!v) return '';
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v).trim()) ? '' : 'Use HH:MM (ex.: 07:30).';
}
function minutosDaHora(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Dias corridos entre duas datas ISO (b - a). */
function diasEntre(a, b) {
  const da = paraData(a); const db = paraData(b);
  if (!da || !db) return null;
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}
function somarDias(iso, dias) {
  const d = paraData(iso);
  if (!d) return null;
  return formatarData(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias), 'iso');
}

/** Situacao do prazo contratual em uma data: { dia, prazo, restantes, termino } ou null. */
function prazoNaData(iso) {
  const c = estado.config || {};
  if (!c.inicio) return null;
  const dia = diasEntre(c.inicio, iso) + 1;
  const prazo = num(c.prazoDias) || null;
  return { dia, prazo, restantes: prazo ? prazo - dia : null, termino: prazo ? somarDias(c.inicio, prazo - 1) : null };
}
function textoPrazo(iso) {
  const p = prazoNaData(iso);
  if (!p) return 'Prazo não configurado';
  if (!p.prazo) return `Dia ${p.dia} da obra`;
  if (p.restantes < 0) return `Dia ${p.dia} de ${p.prazo} · ${-p.restantes} dia(s) além do prazo`;
  return `Dia ${p.dia} de ${p.prazo} · restam ${p.restantes} dia(s)`;
}

/** Jornada do dia em horas (horario de trabalho menos intervalo). */
function jornadaHoras(rdo) {
  const hr = rdo.horario || {};
  const ini = minutosDaHora(hr.inicio); const fim = minutosDaHora(hr.fim);
  if (ini == null || fim == null || fim <= ini) return 0;
  return Math.max(0, (fim - ini - num(hr.intervaloMin)) / 60);
}
function homemHoraLinha(l, rdo) {
  if (l.presenca !== 'Presente') return 0;
  const horas = temValor(l.horas) ? num(l.horas) : jornadaHoras(rdo) * (Number(l.fracao) || 1);
  return num(l.quantidade) * horas;
}
const efetivoPresente = (rdo) => (rdo.efetivo || []).filter((l) => l.presenca === 'Presente').reduce((s, l) => s + num(l.quantidade) * (Number(l.fracao) || 1), 0);
const homemHora = (rdo) => (rdo.efetivo || []).reduce((s, l) => s + homemHoraLinha(l, rdo), 0);
const efetivoPorTipo = (rdo) => {
  const propria = String((estado.config || {}).contratada || '').trim().toLowerCase();
  let proprio = 0; let terceiros = 0;
  (rdo.efetivo || []).filter((l) => l.presenca === 'Presente').forEach((l) => {
    const q = num(l.quantidade) * (Number(l.fracao) || 1);
    if (propria && String(l.empresa || '').trim().toLowerCase() === propria) proprio += q; else terceiros += q;
  });
  return { proprio, terceiros };
};

/** Condicao do dia pelos turnos trabalhados: Praticavel | Parcial | Impraticavel | Sem registro. */
function condicaoDoDia(rdo) {
  const turnos = TURNOS.map((t) => (rdo.clima || {})[t.chave] || {}).filter((t) => t.tempo && t.tempo !== 'Não trabalhado');
  if (!turnos.length) return 'Sem registro';
  const imp = turnos.filter((t) => t.condicao === 'Impraticável').length;
  if (!imp) return 'Praticável';
  return imp === turnos.length ? 'Impraticável' : 'Parcial';
}
const VARIANTE_CONDICAO = { 'Praticável': 'success', Parcial: 'warning', 'Impraticável': 'danger', 'Sem registro': 'neutral' };
const resumoClima = (rdo) => TURNOS.map((t) => ((rdo.clima || {})[t.chave] || {}).tempo).filter(Boolean).map((x) => (x === 'Não trabalhado' ? '—' : x)).join(' / ') || '—';

const listaRdos = () => [...estado.rdos.values()].sort((a, b) => a.data.localeCompare(b.data));
const rdoAnterior = (iso) => listaRdos().filter((r) => r.data < iso).pop() || null;
const travado = (r) => STATUS_TRAVADOS.includes(r.status);
const podeEditarRdo = (r) => podeEditarPerfil() && ['rascunho', 'recusado'].includes(r.status);


/* =============================================================================
   03. ARMAZENAMENTO NESTE APARELHO (IndexedDB) E NUVEM
   Cada item local: { chave, valor, pendente, em }. Chaves:
     {obra}|config   {obra}|rdo|{id}   {obra}|foto|{rdoId}|{fotoId}
   ========================================================================== */

const memoriaLocal = new Map();   // usado na demonstracao e se o navegador nao tiver IndexedDB
let bancoLocal = null;
function abrirBancoLocal() {
  if (!bancoLocal) {
    bancoLocal = new Promise((resolver, rejeitar) => {
      if (!window.indexedDB) { rejeitar(new Error('sem IndexedDB')); return; }
      const pedido = indexedDB.open('rdo-kz', 1);
      pedido.onupgradeneeded = () => { pedido.result.createObjectStore('itens', { keyPath: 'chave' }); };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    }).catch((erro) => { bancoLocal = null; throw erro; });
  }
  return bancoLocal;
}
async function operacaoLocal(modo, acao) {
  const db = await abrirBancoLocal();
  return new Promise((resolver, rejeitar) => {
    const tx = db.transaction('itens', modo);
    const pedido = acao(tx.objectStore('itens'));
    let resultado;
    if (pedido) pedido.onsuccess = () => { resultado = pedido.result; };
    tx.oncomplete = () => resolver(resultado);
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error || new Error('Gravação neste aparelho cancelada (espaço cheio?).'));
  });
}
const usarMemoria = () => ehDemo();
const chaveLocal = (...partes) => [estado.obra.id, ...partes].join('|');

async function localLer(chave) {
  if (usarMemoria()) return memoriaLocal.get(chave) || null;
  try { return (await operacaoLocal('readonly', (st) => st.get(chave))) || null; } catch (erro) { return memoriaLocal.get(chave) || null; }
}
async function localGravar(chave, valor, pendente) {
  const item = { chave, valor: copiaProfunda(valor), pendente: Boolean(pendente), em: agoraIso() };
  memoriaLocal.set(chave, item);
  if (usarMemoria()) return;
  try { await operacaoLocal('readwrite', (st) => st.put(item)); } catch (erro) { estado.sync.erro = `Não foi possível gravar neste aparelho: ${erro.message}`; }
}
async function localApagar(chave) {
  memoriaLocal.delete(chave);
  if (usarMemoria()) return;
  try { await operacaoLocal('readwrite', (st) => st.delete(chave)); } catch (erro) { /* sem banco */ }
}
async function localListar(prefixo) {
  if (usarMemoria()) return [...memoriaLocal.values()].filter((i) => i.chave.startsWith(prefixo));
  try { return (await operacaoLocal('readonly', (st) => st.getAll(IDBKeyRange.bound(prefixo, `${prefixo}￿`)))) || []; } catch (erro) { return [...memoriaLocal.values()].filter((i) => i.chave.startsWith(prefixo)); }
}

/* ---- Nuvem (Firestore do Portal KZ) ---- */
const nuvemDemo = new Map();      // demonstracao: "nuvem" em memoria
const caminhoControle = () => ['obras', estado.obra.id, estado.controle];
const limparParaNuvem = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));

async function firestore() { return KZ.iniciarFirebase(FIREBASE_KZ); }
function erroNuvem(erro) {
  const t = String((erro && (erro.code || erro.message)) || erro);
  if (/permission/i.test(t)) return new Error('Sem permissão na nuvem para esta ação. O gestor da obra precisa liberar o papel Editor (ou Admin) no RDO, no Portal KZ.');
  if (/unavailable|network|offline/i.test(t)) return new Error('Sem conexão com a nuvem.');
  return erro instanceof Error ? erro : new Error(t);
}
async function nuvem(acao) {
  try { return await acao(); } catch (erro) { throw erroNuvem(erro); }
}

const nuvemListar = () => nuvem(async () => {
  if (ehDemo()) return [...nuvemDemo.entries()].filter(([k]) => !k.includes('/')).map(([id, d]) => ({ id, ...copiaProfunda(d) }));
  const { db, fs } = await firestore();
  const snap = await fs.getDocs(fs.collection(db, ...caminhoControle()));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
});
const nuvemLer = (id) => nuvem(async () => {
  if (ehDemo()) return nuvemDemo.has(id) ? copiaProfunda(nuvemDemo.get(id)) : null;
  const { db, fs } = await firestore();
  const d = await fs.getDoc(fs.doc(db, ...caminhoControle(), id));
  return d.exists() ? d.data() : null;
});
const nuvemGravar = (id, dados) => nuvem(async () => {
  if (ehDemo()) { nuvemDemo.set(id, copiaProfunda(dados)); return; }
  const { db, fs } = await firestore();
  await fs.setDoc(fs.doc(db, ...caminhoControle(), id), limparParaNuvem(dados));
});
/** Acrescenta itens a listas (adendos, historico) sem tocar no resto do documento. */
const nuvemAcrescentar = (id, campos, listas) => nuvem(async () => {
  if (ehDemo()) {
    const d = nuvemDemo.get(id) || {};
    Object.assign(d, copiaProfunda(campos));
    Object.entries(listas).forEach(([k, itens]) => { d[k] = [...(d[k] || []), ...copiaProfunda(itens)]; });
    nuvemDemo.set(id, d);
    return;
  }
  const { db, fs } = await firestore();
  const extra = {};
  Object.entries(listas).forEach(([k, itens]) => { extra[k] = fs.arrayUnion(...limparParaNuvem(itens)); });
  await fs.updateDoc(fs.doc(db, ...caminhoControle(), id), { ...limparParaNuvem(campos), ...extra });
});
const nuvemApagar = (id) => nuvem(async () => {
  if (ehDemo()) { nuvemDemo.delete(id); [...nuvemDemo.keys()].filter((k) => k.startsWith(`${id}/`)).forEach((k) => nuvemDemo.delete(k)); return; }
  const { db, fs } = await firestore();
  const fotos = await fs.getDocs(fs.collection(db, ...caminhoControle(), id, 'fotos'));
  await Promise.all(fotos.docs.map((d) => fs.deleteDoc(d.ref)));
  await fs.deleteDoc(fs.doc(db, ...caminhoControle(), id));
});
const nuvemFotoGravar = (rdoId, fotoId, dados) => nuvem(async () => {
  if (ehDemo()) { nuvemDemo.set(`${rdoId}/${fotoId}`, dados); return; }
  const { db, fs } = await firestore();
  await fs.setDoc(fs.doc(db, ...caminhoControle(), rdoId, 'fotos', fotoId), dados);
});
const nuvemFotoLer = (rdoId, fotoId) => nuvem(async () => {
  if (ehDemo()) return nuvemDemo.get(`${rdoId}/${fotoId}`) || null;
  const { db, fs } = await firestore();
  const d = await fs.getDoc(fs.doc(db, ...caminhoControle(), rdoId, 'fotos', fotoId));
  return d.exists() ? d.data() : null;
});
const nuvemFotoApagar = (rdoId, fotoId) => nuvem(async () => {
  if (ehDemo()) { nuvemDemo.delete(`${rdoId}/${fotoId}`); return; }
  const { db, fs } = await firestore();
  await fs.deleteDoc(fs.doc(db, ...caminhoControle(), rdoId, 'fotos', fotoId));
});


/* =============================================================================
   04. CARREGAMENTO E SINCRONIZACAO
   ========================================================================== */

/** Carrega o que esta neste aparelho e, com sinal, atualiza pela nuvem. */
async function carregarObra() {
  estado.rdos = new Map();
  estado.pendentes = new Set();
  estado.fotosPendentes = new Set();
  estado.configPendente = false;
  const prefixo = `${estado.obra.id}|`;
  const locais = await localListar(prefixo);
  locais.forEach((item) => {
    const partes = item.chave.split('|');
    if (partes[1] === 'config') { estado.config = normalizarConfig(item.valor); estado.configPendente = item.pendente; }
    if (partes[1] === 'rdo') { estado.rdos.set(partes[2], item.valor); if (item.pendente) estado.pendentes.add(partes[2]); }
    if (partes[1] === 'foto' && item.pendente) estado.fotosPendentes.add(`${partes[2]}|${partes[3]}`);
  });
  if (!estado.config) estado.config = configVazia();
  if (navigator.onLine || ehDemo()) {
    try { await baixarDaNuvem(); } catch (erro) { estado.sync.erro = erro.message; }
  }
  aplicarAprovadores();
}

/** Baixa config e RDOs da nuvem; o que esta pendente neste aparelho prevalece (exceto RDO ja travado na nuvem). */
async function baixarDaNuvem() {
  const docs = await nuvemListar();
  const avisos = [];
  for (const d of docs) {
    const { id, ...dados } = d;
    if (id === 'config') {
      if (!estado.configPendente) { estado.config = normalizarConfig(dados); await localGravar(chaveLocal('config'), estado.config, false); }
    } else if (id.startsWith('rdo-')) {
      const local = estado.rdos.get(id);
      if (estado.pendentes.has(id) && local) {
        if (travado(dados) && (dados.atualizadoEm || '') > (local._baseNuvem || '')) {
          avisos.push(formatarData(dados.data));
          estado.pendentes.delete(id);
          estado.rdos.set(id, daNuvem(id, dados));
          await localGravar(chaveLocal('rdo', id), estado.rdos.get(id), false);
        }
      } else {
        estado.rdos.set(id, daNuvem(id, dados));
        await localGravar(chaveLocal('rdo', id), estado.rdos.get(id), false);
      }
    }
  }
  // RDO apagado na nuvem (e sem alteracao pendente aqui) sai deste aparelho
  const idsNuvem = new Set(docs.map((d) => d.id));
  for (const id of [...estado.rdos.keys()]) {
    if (!idsNuvem.has(id) && !estado.pendentes.has(id)) { estado.rdos.delete(id); await localApagar(chaveLocal('rdo', id)); }
  }
  estado.sync.ultimo = agoraIso();
  if (avisos.length) toast.aviso('Alterações descartadas', `O(s) RDO(s) de ${avisos.join(', ')} já foram aprovados na nuvem; as alterações feitas neste aparelho foram descartadas.`);
}

/** Aprovadores: do Portal KZ (controle RDO da obra); sem eles, os provisorios da configuracao. */
function aplicarAprovadores() {
  const portal = estado.aprovadoresPortal || {};
  const prov = (estado.config || {}).aprovadoresProvisorios || {};
  estado.aprovadoresDoPortal = Boolean(portal.contratada || portal.contratante);
  estado.aprovadores = estado.aprovadoresDoPortal
    ? { contratada: portal.contratada || '', contratante: portal.contratante || '' }
    : { contratada: prov.contratada || '', contratante: prov.contratante || '' };
}

/* ---- v1.3.0: varias pessoas no mesmo relatorio ----
   Cada RDO guarda neste aparelho a ultima versao recebida da nuvem (_anc). Ao enviar, junta tres
   versoes item por item: so o aparelho mudou -> aparelho; so a nuvem mudou -> nuvem; os dois
   mudaram o mesmo item -> vale este aparelho (ultima alteracao). Sem referencia: une tudo. */
const LISTAS_RDO = { efetivo: '_id', equipamentos: '_id', atividades: '_id', ocorrencias: '_id', materiais: '_id', visitas: '_id', fotos: 'id' };
const OBJETOS_RDO = ['clima', 'horario', 'aprovacoes'];
const ACUMULAM_RDO = ['historico', 'adendos'];
const FORA_DA_JUNCAO = ['id', '_baseNuvem', '_anc', 'atualizadoEm', 'atualizadoPor', ...ACUMULAM_RDO];

/** JSON com as chaves em ordem e sem campos vazios (a nuvem devolve os campos em outra ordem). */
function jsonEstavel(v) {
  const limpar = (x) => {
    if (Array.isArray(x)) return x.map(limpar);
    if (x && typeof x === 'object') {
      const o = {};
      Object.keys(x).sort().forEach((k) => { if (x[k] !== null && x[k] !== undefined) o[k] = limpar(x[k]); });
      return o;
    }
    return x;
  };
  return JSON.stringify(limpar(v));
}
const semControle = (r) => { const { _baseNuvem, _anc, ...resto } = r || {}; return resto; };
const daNuvem = (id, dados) => ({ ...dados, id, _baseNuvem: dados.atualizadoEm || '', _anc: copiaProfunda({ ...dados, id }) });

function itensDoRdo(r) {
  const m = new Map();
  Object.entries(r || {}).forEach(([k, v]) => {
    if (FORA_DA_JUNCAO.includes(k) || v === null || v === undefined) return;
    if (LISTAS_RDO[k] && Array.isArray(v)) v.forEach((it, i) => m.set(`${k}|${(it && it[LISTAS_RDO[k]]) || `i${i}`}`, jsonEstavel(it)));
    else if (OBJETOS_RDO.includes(k) && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([s, x]) => { if (x !== null && x !== undefined) m.set(`${k}.${s}`, jsonEstavel(x)); });
    else m.set(`f|${k}`, jsonEstavel(v));
  });
  return m;
}

/** Junta anc (pode ser null), local e nuvem. Devolve { rdo, daNuvem, conflitos }. */
function mesclarRdo(anc, local, nuvem) {
  const a = anc ? itensDoRdo(anc) : null;
  const l = itensDoRdo(local);
  const n = itensDoRdo(nuvem);
  const itens = new Map();
  let deNuvem = 0; let conflitos = 0;
  new Set([...l.keys(), ...n.keys(), ...(a ? a.keys() : [])]).forEach((k) => {
    const va = a ? a.get(k) : undefined; const vl = l.get(k); const vn = n.get(k);
    let v;
    if (vl === vn) v = vl;
    else if (a && vl === va) { v = vn; deNuvem += 1; }
    else if (a && vn === va) v = vl;
    else { v = vl !== undefined ? vl : vn; if (a) conflitos += 1; if (v === vn) deNuvem += 1; }
    if (v !== undefined) itens.set(k, v);
  });
  const rdo = {};
  Object.keys(LISTAS_RDO).forEach((lista) => {
    const chave = LISTAS_RDO[lista];
    const ordem = [];
    [...(local[lista] || []), ...(nuvem[lista] || [])].forEach((it, i) => { const k = `${lista}|${(it && it[chave]) || `i${i}`}`; if (!ordem.includes(k)) ordem.push(k); });
    [...itens.keys()].filter((k) => k.startsWith(`${lista}|`) && !ordem.includes(k)).forEach((k) => ordem.push(k));
    rdo[lista] = ordem.filter((k) => itens.has(k)).map((k) => JSON.parse(itens.get(k)));
  });
  itens.forEach((v, k) => {
    if (k.startsWith('f|')) rdo[k.slice(2)] = JSON.parse(v);
    else if (k.includes('.') && OBJETOS_RDO.includes(k.slice(0, k.indexOf('.')))) {
      const o = k.slice(0, k.indexOf('.'));
      rdo[o] = { ...(rdo[o] || {}), [k.slice(o.length + 1)]: JSON.parse(v) };
    }
  });
  if (!rdo.aprovacoes) rdo.aprovacoes = { contratada: null, contratante: null };
  ACUMULAM_RDO.forEach((lista) => {   // so acrescentam: une as duas, sem repetir, em ordem de data
    const vistos = new Set(); const todos = [];
    [...(nuvem[lista] || []), ...(local[lista] || [])].forEach((x) => { const j = jsonEstavel(x); if (!vistos.has(j)) { vistos.add(j); todos.push(x); } });
    rdo[lista] = todos.sort((x, y) => String((x && x.em) || '').localeCompare(String((y && y.em) || '')));
  });
  const maisNovo = String(local.atualizadoEm || '') >= String(nuvem.atualizadoEm || '') ? local : nuvem;
  rdo.atualizadoEm = maisNovo.atualizadoEm || agoraIso();
  rdo.atualizadoPor = maisNovo.atualizadoPor || '';
  rdo.id = local.id || nuvem.id;
  return { rdo, daNuvem: deNuvem, conflitos };
}

/** Le, junta e grava o RDO na nuvem numa transacao. calcular(naNuvem) devolve o que gravar (ou null para nao gravar). */
const nuvemJuntarGravar = (id, calcular) => nuvem(async () => {
  if (ehDemo()) {
    const final = calcular(nuvemDemo.has(id) ? copiaProfunda(nuvemDemo.get(id)) : null);
    if (final) nuvemDemo.set(id, copiaProfunda(final));
    return;
  }
  const { db, fs } = await firestore();
  const ref = fs.doc(db, ...caminhoControle(), id);
  await fs.runTransaction(db, async (tx) => {
    const d = await tx.get(ref);
    const final = calcular(d.exists() ? d.data() : null);
    if (final) tx.set(ref, limparParaNuvem(final));
  });
});

const algumModalAberto = () => Boolean(document.querySelector('.ctc-modal.is-open'));
function redesenharSePuder(recebidos) {
  if (!aplicativo || !recebidos) return;
  if (!algumModalAberto()) aplicativo.navegar(aplicativo.paginaAtual());
  toast.info('Lançamentos de outras pessoas', `${recebidos} item(ns) recebido(s) da nuvem da obra.`);
}

/** A cada minuto: envia o que estiver pendente e busca o que os outros lancaram. */
async function buscarNovidades() {
  if (!aplicativo || estado.sync.rodando || algumModalAberto() || document.hidden) return;
  if (!navigator.onLine && !ehDemo()) return;
  if (totalPendente()) await sincronizar({ silencioso: true });
  const antes = jsonEstavel([...estado.rdos.values()].map((r) => [r.id, r.atualizadoEm, r.status]).concat([[estado.config && estado.config.atualizadoEm]]));
  try { await baixarDaNuvem(); } catch (erro) { estado.sync.erro = erro.message; return; }
  aplicarAprovadores();
  const depois = jsonEstavel([...estado.rdos.values()].map((r) => [r.id, r.atualizadoEm, r.status]).concat([[estado.config && estado.config.atualizadoEm]]));
  if (antes !== depois && !algumModalAberto()) { aplicativo.navegar(aplicativo.paginaAtual()); toast.info('Atualizado', 'Há lançamentos novos de outras pessoas.'); }
}

let temporizadorSync = null;
function agendarSincronizacao() {
  clearTimeout(temporizadorSync);
  temporizadorSync = setTimeout(() => sincronizar({ silencioso: true }), 1500);
}
const totalPendente = () => estado.pendentes.size + estado.fotosPendentes.size + (estado.configPendente ? 1 : 0);

/** Envia para a nuvem tudo o que esta pendente neste aparelho. */
async function sincronizar({ silencioso = false } = {}) {
  if (estado.sync.rodando) return false;
  if (!navigator.onLine && !ehDemo()) {
    if (!silencioso) toast.aviso('Sem sinal', 'Tudo continua guardado neste aparelho e vai para a nuvem quando a conexão voltar.');
    return false;
  }
  estado.sync.rodando = true;
  try {
    // 1) fotos primeiro (o RDO so aponta para fotos que ja estao na nuvem)
    for (const chave of [...estado.fotosPendentes]) {
      const [rdoId, fotoId] = chave.split('|');
      const item = await localLer(chaveLocal('foto', rdoId, fotoId));
      if (item && item.valor) await nuvemFotoGravar(rdoId, fotoId, item.valor);
      if (item) await localGravar(item.chave, item.valor, false);
      estado.fotosPendentes.delete(chave);
    }
    // 2) configuracao
    if (estado.configPendente) {
      await nuvemGravar('config', { ...estado.config, atualizadoEm: agoraIso(), atualizadoPor: meuNome() });
      estado.configPendente = false;
      await localGravar(chaveLocal('config'), estado.config, false);
    }
    // 3) RDOs
    const descartados = [];
    let recebidos = 0; let conflitos = 0;
    for (const id of [...estado.pendentes]) {
      const local = estado.rdos.get(id);
      if (!local) { estado.pendentes.delete(id); continue; }
      let travadoNaNuvem = null; let final = null; let info = null;
      await nuvemJuntarGravar(id, (naNuvem) => {
        travadoNaNuvem = null; info = null;
        if (naNuvem && travado(naNuvem)) { travadoNaNuvem = naNuvem; return null; }   // aprovado na nuvem: vale a nuvem
        info = naNuvem ? mesclarRdo(local._anc || null, semControle(local), naNuvem) : { rdo: semControle(local), daNuvem: 0, conflitos: 0 };
        final = info.rdo;
        return final;
      });
      if (travadoNaNuvem) {
        descartados.push(formatarData(local.data));
        estado.rdos.set(id, daNuvem(id, travadoNaNuvem));
      } else {
        estado.rdos.set(id, daNuvem(id, final));
        recebidos += info.daNuvem; conflitos += info.conflitos;
      }
      await localGravar(chaveLocal('rdo', id), estado.rdos.get(id), false);
      estado.pendentes.delete(id);
    }
    redesenharSePuder(recebidos);
    estado.sync.ultimo = agoraIso();
    estado.sync.erro = null;
    if (descartados.length) toast.aviso('Alterações descartadas', `O(s) RDO(s) de ${descartados.join(', ')} já tinham sido aprovados na nuvem.`);
    if (!silencioso) toast.sucesso('Sincronizado', conflitos ? `Enviado. Em ${conflitos} item(ns) mexidos por duas pessoas, valeu a alteração deste aparelho.` : 'Tudo foi juntado com o que está na nuvem da obra e enviado.');
    return true;
  } catch (erro) {
    estado.sync.erro = erro.message;
    if (!silencioso) toast.erro('Falha na sincronização', `${erro.message} Nada foi perdido: continua guardado neste aparelho.`);
    return false;
  } finally {
    estado.sync.rodando = false;
    atualizarPilulaSinc();
  }
}
window.addEventListener('online', () => { if (aplicativo && totalPendente()) sincronizar({ silencioso: true }); });

/** Exige internet para acoes que nao podem ser feitas offline (aprovar, recusar, adendo, configuracao). */
function exigirSinal(acao) {
  if (navigator.onLine || ehDemo()) return true;
  toast.aviso('Precisa de internet', `${acao} só pode ser feito com sinal, para que todos vejam a mesma versão.`);
  return false;
}


/* =============================================================================
   05. REGRAS DO RDO
   ========================================================================== */

function rdoVazio(dataIso) {
  const c = estado.config;
  const numero = Math.max(0, ...listaRdos().map((r) => num(r.numero))) + 1;
  return {
    id: idRdo(dataIso), data: dataIso, numero, status: 'rascunho',
    criadoEm: agoraIso(), criadoPor: meuNome(), criadoPorEmail: meuEmail(),
    atualizadoEm: agoraIso(), atualizadoPor: meuNome(),
    responsavel: meuNome(),
    clima: Object.fromEntries(TURNOS.map((t) => [t.chave, { tempo: t.chave === 'noite' ? 'Não trabalhado' : 'Bom', condicao: 'Praticável' }])),
    chuvaMm: null,
    horario: { inicio: c.horaInicio || '07:00', fim: c.horaFim || '17:00', intervaloMin: num(c.intervaloMin), paralisacaoHoras: null, paralisacaoMotivo: '' },
    efetivo: [], equipamentos: [], atividades: [], ocorrencias: [], materiais: [], visitas: [],
    fotos: [], comentarios: '',
    aprovacoes: { contratada: null, contratante: null },
    adendos: [],
    historico: [{ acao: 'Criado', autor: meuNome(), em: agoraIso() }],
  };
}

/** Cria o RDO do dia (opcionalmente copiando efetivo, equipamentos e atividades nao concluidas do anterior). */
async function criarRdo(dataIso, { copiar }) {
  const id = idRdo(dataIso);
  if (estado.rdos.has(id)) throw new Error(`Já existe o RDO de ${formatarData(dataIso)}.`);
  const rdo = rdoVazio(dataIso);
  if (copiar) {
    const ant = rdoAnterior(dataIso);
    if (ant) {
      const novoId = (l) => ({ ...copiaProfunda(l), _id: gerarId('l') });
      rdo.efetivo = (ant.efetivo || []).map((l) => ({ ...novoId(l), presenca: 'Presente', horas: null }));
      rdo.equipamentos = (ant.equipamentos || []).map((l) => ({ ...novoId(l), horas: null }));
      rdo.atividades = (ant.atividades || []).filter((l) => !['Concluída'].includes(l.situacao)).map((l) => ({ ...novoId(l), situacao: 'Em andamento', quantidade: null }));
      rdo.horario = { ...copiaProfunda(ant.horario || rdo.horario), paralisacaoHoras: null, paralisacaoMotivo: '' };
      rdo.historico[0].obs = `Copiado do RDO de ${formatarData(ant.data)}`;
    }
  }
  await gravarRdo(rdo, { semHistorico: true });
  return rdo;
}

/** Grava o RDO neste aparelho (pendente) e agenda o envio para a nuvem. */
async function gravarRdo(rdo, { semHistorico = false, acao } = {}) {
  rdo.atualizadoEm = agoraIso();
  rdo.atualizadoPor = meuNome();
  if (!semHistorico && acao) rdo.historico = [...(rdo.historico || []), { acao, autor: meuNome(), em: agoraIso() }];
  estado.rdos.set(rdo.id, rdo);
  estado.pendentes.add(rdo.id);
  await localGravar(chaveLocal('rdo', rdo.id), rdo, true);
  atualizarPilulaSinc();
  agendarSincronizacao();
}

/** Altera um RDO editavel, conferindo antes se ele nao foi travado. */
async function editarRdo(id, alterar, acao) {
  const rdo = estado.rdos.get(id);
  if (!rdo) return false;
  if (!podeEditarRdo(rdo)) {
    toast.aviso('RDO não editável', travado(rdo) ? 'O RDO já foi aprovado: use "Adicionar adendo".' : 'Este RDO não pode ser editado pelo seu perfil ou situação.');
    return false;
  }
  const copia = copiaProfunda(rdo);
  alterar(copia);
  await gravarRdo(copia, { acao });
  return true;
}

/** Verifica se o RDO esta completo o bastante para enviar. */
function pendenciasParaEnviar(rdo) {
  const faltas = [];
  if (!TURNOS.some((t) => ((rdo.clima || {})[t.chave] || {}).tempo)) faltas.push('clima do dia');
  if (blocoVisivel('efetivo') && !(rdo.efetivo || []).length) faltas.push('efetivo');
  if (!(rdo.atividades || []).length && !(rdo.ocorrencias || []).length) faltas.push('pelo menos uma atividade ou ocorrência');
  return faltas;
}

async function enviarRdo(id) {
  const rdo = estado.rdos.get(id);
  const faltas = pendenciasParaEnviar(rdo);
  if (faltas.length) { toast.aviso('Falta preencher', `Antes de enviar, informe: ${faltas.join(', ')}.`); return; }
  if (!(await confirmar({ titulo: `Enviar o RDO de ${formatarData(rdo.data)}?`, mensagem: 'Depois de enviado, o RDO segue para a aprovação da contratada e só volta a ser editado se for retirado do envio ou recusado.', textoConfirmar: 'Enviar para aprovação' }))) return;
  const copia = copiaProfunda(rdo);
  copia.status = 'enviado';
  copia.enviadoEm = agoraIso();
  copia.enviadoPor = meuNome();
  copia.aprovacoes = { contratada: null, contratante: null };
  await gravarRdo(copia, { acao: 'Enviado para aprovação' });
  toast.sucesso('Relatório enviado', estado.aprovadores.contratada ? `Aguardando a 1ª aprovação: ${estado.aprovadores.contratada}.` : 'Atenção: a obra ainda não tem aprovador da contratada cadastrado.');
  aplicativo.navegar('rdo');
}

async function retirarEnvio(id) {
  const rdo = estado.rdos.get(id);
  if (rdo.status !== 'enviado' || !podeEditarPerfil()) return;
  if (!exigirSinal('Retirar do envio')) return;
  const naNuvem = await lerSituacaoAtual(id);
  if (naNuvem && naNuvem.status !== 'enviado') { toast.aviso('Não foi possível', 'A situação do RDO mudou na nuvem. A tela foi atualizada.'); aplicativo.navegar(paginaRdoAtual()); return; }
  const copia = copiaProfunda(rdo);
  copia.status = 'rascunho';
  await gravarRdo(copia, { acao: 'Retirado do envio para correção' });
  await sincronizar({ silencioso: true });
  aplicativo.navegar(paginaRdoAtual());
}

/** Le a situacao atual do RDO na nuvem (e atualiza a copia local). */
async function lerSituacaoAtual(id) {
  const naNuvem = await nuvemLer(id);
  if (naNuvem && !estado.pendentes.has(id)) {
    estado.rdos.set(id, daNuvem(id, naNuvem));
    await localGravar(chaveLocal('rdo', id), estado.rdos.get(id), false);
  }
  return naNuvem;
}

/** Aprovacao de um dos lados (contratada / contratante). Feita direto na nuvem. */
async function aprovarRdo(id, lado) {
  if (!exigirSinal('Aprovar')) return;
  if (estado.pendentes.has(id)) await sincronizar({ silencioso: true });
  const atual = await lerSituacaoAtual(id);
  if (!atual) { toast.aviso('RDO ainda não está na nuvem', 'Sincronize o aparelho de quem preencheu antes de aprovar.'); return; }
  const esperado = lado === 'contratada' ? 'enviado' : 'em-aprovacao';
  if (atual.status !== esperado) { toast.aviso('Situação mudou', `Este RDO está "${STATUS_RDO[atual.status].curto}" e não aguarda a sua aprovação.`); aplicativo.navegar(paginaRdoAtual()); return; }
  const obs = await solicitarValor({ titulo: `Aprovar o RDO de ${formatarData(atual.data)} (${lado})`, rotulo: 'Comentário da aprovação (opcional)', tipo: 'textarea', textoConfirmar: 'Aprovar' });
  if (obs === null) return;
  const aprov = { email: meuEmail(), nome: meuNome(), em: agoraIso(), obs: obs || '' };
  const novoStatus = lado === 'contratada' ? 'em-aprovacao' : 'aprovado';
  try {
    await nuvemAcrescentar(id, { status: novoStatus, [`aprovacoes.${lado}`]: aprov, atualizadoEm: agoraIso(), atualizadoPor: meuNome() },
      { historico: [{ acao: `Aprovado pela ${lado}`, autor: meuNome(), em: agoraIso(), obs: obs || '' }] });
    if (ehDemo()) { const d = nuvemDemo.get(id); d.aprovacoes = { ...(d.aprovacoes || {}), [lado]: aprov }; delete d[`aprovacoes.${lado}`]; }
    await lerSituacaoAtual(id);
    toast.sucesso('RDO aprovado', novoStatus === 'aprovado' ? 'Aprovação concluída pelos dois lados.' : 'Agora segue para a aprovação do contratante.');
  } catch (erro) { toast.erro('Não foi possível aprovar', erro.message); }
  aplicativo.navegar(paginaRdoAtual());
}

async function recusarRdo(id, lado) {
  if (!exigirSinal('Recusar')) return;
  const atual = await lerSituacaoAtual(id);
  const esperado = lado === 'contratada' ? 'enviado' : 'em-aprovacao';
  if (!atual || atual.status !== esperado) { toast.aviso('Situação mudou', 'Este RDO não aguarda a sua aprovação.'); aplicativo.navegar(paginaRdoAtual()); return; }
  const motivo = await solicitarValor({ titulo: `Recusar o RDO de ${formatarData(atual.data)}`, rotulo: 'Motivo da recusa (o preenchedor vai ver)', tipo: 'textarea', obrigatorio: true, textoConfirmar: 'Recusar' });
  if (!motivo) return;
  try {
    await nuvemAcrescentar(id, { status: 'recusado', 'aprovacoes.contratada': null, 'aprovacoes.contratante': null, recusa: { lado, nome: meuNome(), email: meuEmail(), em: agoraIso(), motivo }, atualizadoEm: agoraIso(), atualizadoPor: meuNome() },
      { historico: [{ acao: `Recusado pela ${lado}`, autor: meuNome(), em: agoraIso(), obs: motivo }] });
    if (ehDemo()) { const d = nuvemDemo.get(id); d.aprovacoes = { contratada: null, contratante: null }; delete d['aprovacoes.contratada']; delete d['aprovacoes.contratante']; }
    await lerSituacaoAtual(id);
    toast.aviso('RDO recusado', 'Voltou para o preenchedor corrigir.');
  } catch (erro) { toast.erro('Não foi possível recusar', erro.message); }
  aplicativo.navegar(paginaRdoAtual());
}

async function adicionarAdendo(id) {
  if (!exigirSinal('Adicionar adendo')) return;
  const rdo = estado.rdos.get(id);
  const texto = await solicitarValor({ titulo: `Adendo ao RDO de ${formatarData(rdo.data)}`, rotulo: 'Texto do adendo (acrescenta, não altera o RDO aprovado)', tipo: 'textarea', obrigatorio: true, textoConfirmar: 'Adicionar adendo' });
  if (!texto) return;
  const item = { texto, autor: meuNome(), email: meuEmail(), em: agoraIso() };
  try {
    await nuvemAcrescentar(id, { atualizadoEm: agoraIso(), atualizadoPor: meuNome() }, { adendos: [item], historico: [{ acao: 'Adendo adicionado', autor: meuNome(), em: agoraIso() }] });
    await lerSituacaoAtual(id);
    toast.sucesso('Adendo adicionado', 'Ele aparece no RDO e no PDF, com autor, data e hora.');
  } catch (erro) { toast.erro('Não foi possível adicionar', erro.message); }
  aplicativo.navegar(paginaRdoAtual());
}

async function excluirRdo(id) {
  const rdo = estado.rdos.get(id);
  if (!ehAdministrador() || !['rascunho', 'recusado'].includes(rdo.status)) { toast.aviso('Não permitido', 'Só o Administrador exclui, e só RDO em rascunho ou recusado.'); return; }
  if (!(await confirmar({ titulo: `Excluir o RDO de ${formatarData(rdo.data)}?`, mensagem: 'O RDO e as fotos dele são apagados da nuvem e deste aparelho. Não dá para desfazer.', textoConfirmar: 'Excluir', perigo: true }))) return;
  if (!exigirSinal('Excluir')) return;
  try {
    await nuvemApagar(id);
    for (const f of rdo.fotos || []) await localApagar(chaveLocal('foto', id, f.id));
    estado.rdos.delete(id);
    estado.pendentes.delete(id);
    await localApagar(chaveLocal('rdo', id));
    ui.rdoAberto = null;
    toast.sucesso('RDO excluído', formatarData(rdo.data));
    aplicativo.navegar('rdos');
  } catch (erro) { toast.erro('Não foi possível excluir', erro.message); }
}


/* =============================================================================
   06. FOTOS
   Comprimidas no aparelho (lado maior 1280 px, JPEG) com data, hora e obra
   gravadas no canto da imagem. Miniatura de 320 px para a tela.
   ========================================================================== */

function carregarImagem(src) {
  return new Promise((resolver, rejeitar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rejeitar(new Error('Imagem inválida.'));
    img.src = src;
  });
}
function lerArquivoComoUrl(arquivo) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result);
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsDataURL(arquivo);
  });
}
function desenharReduzida(img, lado, carimbo) {
  const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * escala);
  c.height = Math.round(img.naturalHeight * escala);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (carimbo) {
    const fonte = Math.max(14, Math.round(c.width / 45));
    ctx.font = `bold ${fonte}px Arial, sans-serif`;
    const largura = ctx.measureText(carimbo).width;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.fillRect(c.width - largura - fonte * 1.4, c.height - fonte * 2, largura + fonte, fonte * 1.6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(carimbo, c.width - largura - fonte * 0.9, c.height - fonte * 0.75);
  }
  return c;
}

async function adicionarFotos(id, arquivos) {
  const rdo = estado.rdos.get(id);
  if (!podeEditarRdo(rdo)) return;
  const livres = LIMITE_FOTOS - (rdo.fotos || []).length;
  const lista = [...arquivos].filter((a) => /^image\//.test(a.type)).slice(0, Math.max(0, livres));
  if (!lista.length) { toast.aviso('Nenhuma foto adicionada', livres <= 0 ? `Limite de ${LIMITE_FOTOS} fotos por RDO.` : 'Escolha arquivos de imagem.'); return; }
  const novas = [];
  for (const arquivo of lista) {
    try {
      const img = await carregarImagem(await lerArquivoComoUrl(arquivo));
      const quando = arquivo.lastModified ? new Date(arquivo.lastModified) : new Date();
      const carimbo = `${formatarData(quando, 'data-hora')} · ${estado.obra.sigla || estado.obra.nome || ''}`.trim();
      const grande = desenharReduzida(img, 1280, carimbo).toDataURL('image/jpeg', 0.72);
      const mini = desenharReduzida(img, 320, '').toDataURL('image/jpeg', 0.7);
      const fotoId = gerarId('foto');
      await localGravar(chaveLocal('foto', id, fotoId), { dados: grande, mini }, true);
      estado.fotosPendentes.add(`${id}|${fotoId}`);
      novas.push({ id: fotoId, legenda: '', tiradaEm: quando.toISOString(), autor: meuNome() });
    } catch (erro) { toast.erro('Foto não aproveitada', `${arquivo.name}: ${erro.message}`); }
  }
  if (novas.length) {
    await editarRdo(id, (r) => { r.fotos = [...(r.fotos || []), ...novas]; }, `${novas.length} foto(s) adicionada(s)`);
    toast.sucesso('Fotos adicionadas', `${novas.length} foto(s). Toque numa foto para escrever a legenda.`);
  }
  if (lista.length < arquivos.length) toast.aviso('Algumas fotos ficaram de fora', `Limite de ${LIMITE_FOTOS} fotos por RDO.`);
  aplicativo.navegar(paginaRdoAtual());
}

/** Foto { dados, mini }: deste aparelho ou da nuvem (guarda uma copia aqui). */
async function obterFoto(rdoId, fotoId) {
  const local = await localLer(chaveLocal('foto', rdoId, fotoId));
  if (local && local.valor) return local.valor;
  if (!navigator.onLine && !ehDemo()) return null;
  try {
    const nuvemFoto = await nuvemFotoLer(rdoId, fotoId);
    if (nuvemFoto) await localGravar(chaveLocal('foto', rdoId, fotoId), nuvemFoto, false);
    return nuvemFoto;
  } catch (erro) { return null; }
}

function abrirFoto(rdo, foto) {
  const img = h('img', { alt: foto.legenda || 'Foto do RDO' });
  obterFoto(rdo.id, foto.id).then((f) => { if (f) img.src = f.dados; });
  const editavel = podeEditarRdo(rdo);
  const formulario = criarFormulario({
    colunas: 1, semBotoes: true, valores: { legenda: foto.legenda || '', atividadeId: foto.atividadeId || '' },
    campos: [
      { nome: 'legenda', rotulo: 'Legenda', tipo: 'textarea', desabilitado: !editavel },
      { nome: 'atividadeId', rotulo: 'Atividade desta foto (aparece junto da atividade no relatório)', tipo: 'select', placeholder: '— nenhuma —', opcoes: (rdo.atividades || []).map((a) => ({ valor: a._id, texto: `${a.servico}${a.local ? ` · ${a.local}` : ''}` })), desabilitado: !editavel },
    ],
    onEnviar: async ({ legenda, atividadeId }) => {
      await editarRdo(rdo.id, (r) => { const f = r.fotos.find((x) => x.id === foto.id); if (f) { f.legenda = legenda; f.atividadeId = atividadeId || null; } }, 'Foto alterada');
      modal.fechar();
      aplicativo.navegar(paginaRdoAtual());
    },
  });
  const modal = criarModal({
    titulo: `Foto — ${formatarData(foto.tiradaEm, 'data-hora')}`, tamanho: 'lg', destruirAoFechar: true,
    conteudo: [img, h('p', { class: 'ctc-text-xs ctc-text-muted' }, `Adicionada por ${foto.autor || '—'}`), formulario.elemento],
    acoes: editavel ? [
      { texto: 'Excluir foto', variante: 'danger-soft', fechar: false, onClick: async () => {
        if (!(await confirmar({ titulo: 'Excluir esta foto?', mensagem: 'A foto sai do RDO.', textoConfirmar: 'Excluir', perigo: true }))) return;
        await editarRdo(rdo.id, (r) => { r.fotos = r.fotos.filter((x) => x.id !== foto.id); }, 'Foto excluída');
        estado.fotosPendentes.delete(`${rdo.id}|${foto.id}`);
        await localApagar(chaveLocal('foto', rdo.id, foto.id));
        if (navigator.onLine || ehDemo()) nuvemFotoApagar(rdo.id, foto.id).catch(() => {});
        modal.fechar();
        aplicativo.navegar(paginaRdoAtual());
      } },
      { texto: 'Cancelar', variante: 'outline' },
      { texto: 'Salvar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() },
    ] : [{ texto: 'Fechar', variante: 'primary' }],
  });
  modal.abrir();
}


/* =============================================================================
   07. PAGINAS
   ========================================================================== */

const kpi = (config) => criarKpi(config).elemento;
const badgeStatus = (status) => etiquetaStatus(status);

/** Campo de texto com sugestoes do cadastro (datalist): aceita texto livre. */
function camposComSugestoes(campos) {
  const listas = [];
  const finais = campos.map((c) => {
    if (!c.cadastro) return { tipo: 'texto', ...c };
    const idLista = gerarId(`lista-${c.cadastro}`);
    const itens = (estado.config.cadastros[c.cadastro] || []);
    listas.push(h('datalist', { id: idLista }, itens.map((t) => h('option', { value: t }))));
    const { cadastro, ...resto } = c;
    return { tipo: 'texto', ...resto, atributos: { list: idLista, autocomplete: 'off' } };
  });
  return { campos: finais, listas };
}

/** Janela de edicao de uma linha de secao (nova ou existente). */
function abrirLinhaSecao(rdo, secaoId, linha) {
  const def = SECOES_LISTA[secaoId];
  const nova = !linha;
  const valores = nova ? def.novo() : { ...linha };
  const editavel = podeEditarRdo(rdo);
  const { campos, listas } = camposComSugestoes(def.campos.map((c) => ({ ...c, desabilitado: !editavel })));
  const formulario = criarFormulario({
    colunas: 2, semBotoes: true, valores, campos,
    onEnviar: async (v) => {
      const limpo = { ...v, _id: nova ? gerarId('l') : linha._id };
      await editarRdo(rdo.id, (r) => {
        const lista = r[secaoId] || [];
        r[secaoId] = nova ? [...lista, limpo] : lista.map((x) => (x._id === linha._id ? limpo : x));
      }, nova ? `${def.titulo}: item incluído` : `${def.titulo}: item alterado`);
      modal.fechar();
      aplicativo.navegar(paginaRdoAtual());
    },
  });
  const acoes = editavel ? [
    nova ? null : { texto: 'Excluir', variante: 'danger-soft', fechar: false, onClick: async () => {
      if (!(await confirmar({ titulo: `Excluir este ${def.item}?`, mensagem: 'O item sai do RDO.', textoConfirmar: 'Excluir', perigo: true }))) return;
      await editarRdo(rdo.id, (r) => { r[secaoId] = (r[secaoId] || []).filter((x) => x._id !== linha._id); }, `${def.titulo}: item excluído`);
      modal.fechar();
      aplicativo.navegar(paginaRdoAtual());
    } },
    { texto: 'Cancelar', variante: 'outline' },
    nova ? { texto: 'Incluir e novo', variante: 'outline', fechar: false, onClick: async () => {
      const ok = await formulario.enviar();
      if (ok) setTimeout(() => abrirLinhaSecao(estado.rdos.get(rdo.id), secaoId, null), 50);
    } } : null,
    { texto: nova ? 'Incluir' : 'Salvar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() },
  ].filter(Boolean) : [{ texto: 'Fechar', variante: 'primary' }];
  const modal = criarModal({ titulo: `${def.titulo} — ${nova ? 'incluir' : 'editar'}`, tamanho: 'md', destruirAoFechar: true, conteudo: [formulario.elemento, ...listas], acoes });
  modal.abrir();
}

/** Painel de uma secao em lista (tabela + Incluir). */
function painelSecao(rdo, secaoId) {
  const def = SECOES_LISTA[secaoId];
  const linhas = (rdo[secaoId] || []).map((l) => (def.linhaTabela ? def.linhaTabela(l, rdo) : l));
  const editavel = podeEditarRdo(rdo);
  const tabela = criarTabela({
    colunas: def.colunas, dados: linhas, porPagina: 0, altura: 'auto', compacta: true,
    vazio: { titulo: `Nenhum ${def.item} lançado`, mensagem: editavel ? `Toque em "Incluir" para lançar.` : '' },
    onLinhaClick: (l) => abrirLinhaSecao(rdo, secaoId, (rdo[secaoId] || []).find((x) => x._id === l._id)),
  });
  let tag = `${linhas.length} item(ns)`;
  if (secaoId === 'efetivo') tag = `${formatarNumero(efetivoPresente(rdo), 1)} presente(s) · ${formatarNumero(homemHora(rdo), 1)} Hh`;
  return criarPainel({
    titulo: def.titulo, icone: def.icone, tag, semEspaco: true,
    acoes: editavel ? [{ texto: 'Incluir', icone: 'mais', variante: 'primary', tamanho: 'sm', onClick: () => abrirLinhaSecao(rdo, secaoId, null) }] : [],
    conteudo: tabela.elemento,
  }).elemento;
}

function abrirClima(rdo) {
  const editavel = podeEditarRdo(rdo);
  const campos = [];
  TURNOS.forEach((t) => {
    campos.push({ nome: `${t.chave}_tempo`, rotulo: `${t.texto} — tempo`, tipo: 'select', opcoes: TEMPOS, obrigatorio: true, desabilitado: !editavel });
    campos.push({ nome: `${t.chave}_condicao`, rotulo: `${t.texto} — condição`, tipo: 'select', opcoes: CONDICOES, obrigatorio: true, desabilitado: !editavel });
  });
  campos.push({ nome: 'chuvaMm', rotulo: 'Chuva no dia (mm, opcional)', tipo: 'numero', regras: { minimo: 0, maximo: 500 }, desabilitado: !editavel, dica: 'Consulte o mapa de chuva da obra' });
  const valores = { chuvaMm: rdo.chuvaMm };
  TURNOS.forEach((t) => { const c = (rdo.clima || {})[t.chave] || {}; valores[`${t.chave}_tempo`] = c.tempo || 'Bom'; valores[`${t.chave}_condicao`] = c.condicao || 'Praticável'; });
  const formulario = criarFormulario({
    colunas: 2, semBotoes: true, valores, campos,
    onEnviar: async (v) => {
      await editarRdo(rdo.id, (r) => {
        r.clima = Object.fromEntries(TURNOS.map((t) => [t.chave, { tempo: v[`${t.chave}_tempo`], condicao: v[`${t.chave}_tempo`] === 'Não trabalhado' ? 'Praticável' : v[`${t.chave}_condicao`] }]));
        r.chuvaMm = v.chuvaMm;
      }, 'Clima alterado');
      modal.fechar();
      aplicativo.navegar(paginaRdoAtual());
    },
  });
  const link = (estado.config || {}).linkChuva;
  const modal = criarModal({
    titulo: 'Clima e condição de trabalho', tamanho: 'md', destruirAoFechar: true,
    conteudo: [
      link ? h('div', { class: 'ctc-cluster' }, h('a', { class: 'ctc-btn ctc-btn--outline ctc-btn--sm ctc-allow-readonly', href: link, target: '_blank', rel: 'noopener' }, '🌧️ Consultar mapa de chuva')) : null,
      formulario.elemento,
    ],
    acoes: editavel ? [{ texto: 'Cancelar', variante: 'outline' }, { texto: 'Salvar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() }] : [{ texto: 'Fechar', variante: 'primary' }],
  });
  modal.abrir();
}

function abrirHorario(rdo) {
  const editavel = podeEditarRdo(rdo);
  const hr = rdo.horario || {};
  const formulario = criarFormulario({
    colunas: 3, semBotoes: true,
    valores: { inicio: hr.inicio, fim: hr.fim, intervaloMin: hr.intervaloMin, paralisacaoHoras: hr.paralisacaoHoras, paralisacaoMotivo: hr.paralisacaoMotivo },
    campos: [
      { nome: 'inicio', rotulo: 'Início (HH:MM)', obrigatorio: true, regras: { validar: validarHora }, desabilitado: !editavel },
      { nome: 'fim', rotulo: 'Término (HH:MM)', obrigatorio: true, regras: { validar: validarHora }, desabilitado: !editavel },
      { nome: 'intervaloMin', rotulo: 'Intervalo (min)', tipo: 'numero', regras: { minimo: 0, maximo: 600 }, desabilitado: !editavel },
      { nome: 'paralisacaoHoras', rotulo: 'Horas paralisadas', tipo: 'numero', regras: { minimo: 0, maximo: 24 }, desabilitado: !editavel },
      { nome: 'paralisacaoMotivo', rotulo: 'Motivo da paralisação', tipo: 'textarea', larguraTotal: true, desabilitado: !editavel },
    ],
    onEnviar: async (v) => {
      await editarRdo(rdo.id, (r) => { r.horario = { ...v }; }, 'Horário alterado');
      modal.fechar();
      aplicativo.navegar(paginaRdoAtual());
    },
  });
  const modal = criarModal({
    titulo: 'Horário de trabalho', tamanho: 'md', destruirAoFechar: true, conteudo: formulario.elemento,
    acoes: editavel ? [{ texto: 'Cancelar', variante: 'outline' }, { texto: 'Salvar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() }] : [{ texto: 'Fechar', variante: 'primary' }],
  });
  modal.abrir();
}

function abrirComentarios(rdo) {
  const editavel = podeEditarRdo(rdo);
  const formulario = criarFormulario({
    colunas: 1, semBotoes: true, valores: { comentarios: rdo.comentarios || '', responsavel: rdo.responsavel || meuNome() },
    campos: [
      { nome: 'responsavel', rotulo: 'Responsável pelo preenchimento', obrigatorio: true, desabilitado: !editavel },
      { nome: 'comentarios', rotulo: 'Comentários gerais do dia', tipo: 'textarea', desabilitado: !editavel },
    ],
    onEnviar: async (v) => {
      await editarRdo(rdo.id, (r) => { r.comentarios = v.comentarios; r.responsavel = v.responsavel; }, 'Comentários alterados');
      modal.fechar();
      aplicativo.navegar(paginaRdoAtual());
    },
  });
  const modal = criarModal({
    titulo: 'Comentários e responsável', tamanho: 'md', destruirAoFechar: true, conteudo: formulario.elemento,
    acoes: editavel ? [{ texto: 'Cancelar', variante: 'outline' }, { texto: 'Salvar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() }] : [{ texto: 'Fechar', variante: 'primary' }],
  });
  modal.abrir();
}

/** Linhas "rotulo: valor" (lista simples de leitura). */
function linhasInfo(pares) {
  return criarTabela({
    colunas: [{ campo: 'r', titulo: 'Item', ordenavel: false }, { campo: 'v', titulo: 'Informação', ordenavel: false }],
    dados: pares.filter(Boolean).map(([r, v]) => ({ r, v: temValor(v) ? String(v) : '—' })),
    porPagina: 0, altura: 'auto', compacta: true, camposBusca: [],
  }).elemento;
}

/* ---- Pagina: edicao do RDO aberto ---- */
function paginaRdoEditar() {
  const rdo = ui.rdoAberto ? estado.rdos.get(ui.rdoAberto) : null;
  if (!rdo) {
    return [criarAlerta({ tipo: 'info', titulo: 'Nenhum RDO aberto', mensagem: 'Abra um RDO na lista ou crie o RDO do dia.', acoes: [
      { texto: 'Ver lista de RDOs', variante: 'outline', onClick: () => aplicativo.navegar('rdos') },
      podeEditarPerfil() ? { texto: 'Novo RDO', variante: 'primary', onClick: abrirNovoRdo } : null,
    ].filter(Boolean) })];
  }
  const editavel = podeEditarRdo(rdo);
  const st = STATUS_RDO[rdo.status] || STATUS_RDO.rascunho;
  const p = prazoNaData(rdo.data);
  const elementos = [];

  // faixa de situacao e acoes do fluxo
  const acoesFluxo = [criarBotao({ texto: 'Visualizar relatório', icone: 'olho', variante: 'outline', classe: 'ctc-allow-readonly', onClick: () => aplicativo.navegar('rdo') })];
  if (editavel) acoesFluxo.push(criarBotao({ texto: 'Enviar para aprovação', icone: 'check', variante: 'success', onClick: () => enviarRdo(rdo.id) }));
  if (rdo.status === 'enviado' && podeEditarPerfil()) acoesFluxo.push(criarBotao({ texto: 'Retirar do envio', variante: 'outline', onClick: () => retirarEnvio(rdo.id) }));
  if (rdo.status === 'enviado' && souAprovador('contratada')) {
    acoesFluxo.push(criarBotao({ texto: 'Aprovar (contratada)', icone: 'check', variante: 'success', classe: 'ctc-allow-readonly', onClick: () => aprovarRdo(rdo.id, 'contratada') }));
    acoesFluxo.push(criarBotao({ texto: 'Recusar', variante: 'danger-soft', classe: 'ctc-allow-readonly', onClick: () => recusarRdo(rdo.id, 'contratada') }));
  }
  if (rdo.status === 'em-aprovacao' && souAprovador('contratante')) {
    acoesFluxo.push(criarBotao({ texto: 'Aprovar (contratante)', icone: 'check', variante: 'success', classe: 'ctc-allow-readonly', onClick: () => aprovarRdo(rdo.id, 'contratante') }));
    acoesFluxo.push(criarBotao({ texto: 'Recusar', variante: 'danger-soft', classe: 'ctc-allow-readonly', onClick: () => recusarRdo(rdo.id, 'contratante') }));
  }
  if (travado(rdo) && (podeEditarPerfil() || souAprovador('contratada') || souAprovador('contratante'))) {
    acoesFluxo.push(criarBotao({ texto: 'Adicionar adendo', icone: 'mais', variante: 'outline', classe: 'ctc-allow-readonly', onClick: () => adicionarAdendo(rdo.id) }));
  }
  acoesFluxo.push(criarBotao({ texto: 'PDF', icone: 'download', variante: 'primary', classe: 'ctc-allow-readonly', onClick: (ev) => comCarregamento(ev.currentTarget, () => baixarPdfRdos([rdo], { fotos: true })) }));
  acoesFluxo.push(criarBotao({ texto: 'PDF sem fotos', icone: 'download', variante: 'outline', classe: 'ctc-allow-readonly', onClick: (ev) => comCarregamento(ev.currentTarget, () => baixarPdfRdos([rdo], { fotos: false })) }));
  if (ehAdministrador() && ['rascunho', 'recusado'].includes(rdo.status)) acoesFluxo.push(criarBotao({ texto: 'Excluir', icone: 'lixeira', variante: 'danger-soft', onClick: () => excluirRdo(rdo.id) }));

  const tipoAlerta = { rascunho: 'info', enviado: 'info', 'em-aprovacao': 'warning', aprovado: 'success', recusado: 'danger' }[rdo.status];
  let mensagem = editavel ? 'Em preenchimento. Tudo fica salvo neste aparelho na hora; quando terminar, toque em "Enviar para aprovação".' : st.texto;
  if (rdo.status === 'recusado' && rdo.recusa) mensagem = `Recusado pela ${rdo.recusa.lado} (${rdo.recusa.nome}, ${formatarData(rdo.recusa.em, 'data-hora')}): ${rdo.recusa.motivo}`;
  if (rdo.status === 'enviado') mensagem = `Enviado por ${rdo.enviadoPor || '—'} em ${formatarData(rdo.enviadoEm, 'data-hora')}. Aguardando a aprovação da contratada (${estado.aprovadores.contratada || 'aprovador não cadastrado'}).`;
  if (rdo.status === 'em-aprovacao') mensagem = `Aprovado pela contratada. Aguardando o contratante (${estado.aprovadores.contratante || 'aprovador não cadastrado'}). O conteúdo está travado.`;
  if (rdo.status === 'aprovado') mensagem = 'Aprovado pela contratada e pelo contratante. O conteúdo está travado; correções só por adendo.';
  elementos.push(criarAlerta({ tipo: tipoAlerta, titulo: `RDO nº ${rdo.numero} · ${dataLonga(rdo.data)} · ${st.curto}${estado.pendentes.has(rdo.id) ? ' · a enviar para a nuvem' : ''}`, mensagem }));
  elementos.push(h('div', { class: 'ctc-toolbar' }, ...acoesFluxo));

  // indicadores do dia
  const ept = efetivoPorTipo(rdo);
  elementos.push(h('div', { class: 'ctc-grid ctc-grid--4' },
    kpi({ rotulo: 'Prazo', valor: p && p.prazo ? `Dia ${p.dia} de ${p.prazo}` : (p ? `Dia ${p.dia}` : '—'), sub: p && p.prazo ? (p.restantes >= 0 ? `restam ${p.restantes} dia(s)` : `${-p.restantes} dia(s) além do prazo`) : 'configure o início e o prazo', variante: p && p.restantes != null && p.restantes < 0 ? 'danger' : 'accent', progresso: p && p.prazo ? { percentual: Math.min(100, (p.dia / p.prazo) * 100) } : undefined }),
    kpi({ rotulo: 'Condição do dia', valor: condicaoDoDia(rdo), sub: resumoClima(rdo), variante: { Praticável: 'success', Parcial: 'warning', Impraticável: 'danger' }[condicaoDoDia(rdo)] }),
    kpi({ rotulo: 'Efetivo presente', valor: efetivoPresente(rdo), formato: 'numero', casas: 1, sub: `próprio ${formatarNumero(ept.proprio, 1)} · terceiros ${formatarNumero(ept.terceiros, 1)}` }),
    kpi({ rotulo: 'Homem-hora', valor: homemHora(rdo), formato: 'numero', casas: 1, sub: `jornada de ${formatarNumero(jornadaHoras(rdo), 1)} h` })));

  // cabecalho
  const c = estado.config;
  elementos.push(criarPainel({
    titulo: 'Cabeçalho', icone: 'documento', tag: `RDO nº ${rdo.numero}`,
    acoes: editavel ? [{ texto: 'Responsável e comentários', icone: 'editar', variante: 'outline', tamanho: 'sm', onClick: () => abrirComentarios(rdo) }] : [],
    conteudo: linhasInfo([
      ['Obra', `${estado.obra.sigla ? `${estado.obra.sigla} — ` : ''}${estado.obra.nome || ''}`],
      ['Cliente / contratante', c.cliente], ['Contratada', c.contratada], ['Contrato', c.contrato], ['Endereço', c.endereco],
      ['Data', dataLonga(rdo.data)], ['Prazo', textoPrazo(rdo.data)],
      ['Responsável pelo preenchimento', rdo.responsavel], ['Responsável técnico', c.responsavel],
    ]),
  }).elemento);

  // clima e horario
  const linhasClima = TURNOS.map((t) => { const x = (rdo.clima || {})[t.chave] || {}; return { turno: t.texto, tempo: x.tempo || '—', condicao: x.tempo === 'Não trabalhado' ? '—' : (x.condicao || '—') }; });
  const tabelaClima = criarTabela({
    colunas: [{ campo: 'turno', titulo: 'Turno', ordenavel: false }, { campo: 'tempo', titulo: 'Tempo', ordenavel: false },
      { campo: 'condicao', titulo: 'Condição', ordenavel: false, render: (v) => (v === '—' ? '—' : criarBadge({ texto: v, variante: v === 'Praticável' ? 'success' : 'danger' })) }],
    dados: linhasClima, porPagina: 0, altura: 'auto', compacta: true, camposBusca: [],
    onLinhaClick: () => abrirClima(rdo),
  });
  const hr = rdo.horario || {};
  const blocoHorario = blocoVisivel('horario') ? criarPainel({
    titulo: 'Horário de trabalho', icone: 'calendario', tag: `${formatarNumero(jornadaHoras(rdo), 1)} h de jornada`,
    acoes: editavel ? [{ texto: 'Editar', icone: 'editar', variante: 'outline', tamanho: 'sm', onClick: () => abrirHorario(rdo) }] : [],
    conteudo: linhasInfo([['Início', hr.inicio], ['Término', hr.fim], ['Intervalo', temValor(hr.intervaloMin) ? `${hr.intervaloMin} min` : '—'],
      ['Horas paralisadas', temValor(hr.paralisacaoHoras) ? formatarNumero(hr.paralisacaoHoras, 1) : '—'], ['Motivo da paralisação', hr.paralisacaoMotivo]]),
  }).elemento : null;
  elementos.push(h('div', { class: 'ctc-grid ctc-grid--2' },
    criarPainel({
      titulo: 'Clima e condição de trabalho', icone: 'info', tag: temValor(rdo.chuvaMm) ? `${formatarNumero(rdo.chuvaMm, 1)} mm de chuva` : condicaoDoDia(rdo), semEspaco: true,
      acoes: [
        c.linkChuva ? h('a', { class: 'ctc-btn ctc-btn--outline ctc-btn--sm ctc-allow-readonly', href: c.linkChuva, target: '_blank', rel: 'noopener', title: 'Abre o site de mapa de chuva da obra' }, '🌧️ Mapa de chuva') : null,
        editavel ? criarBotao({ texto: 'Editar', icone: 'editar', variante: 'outline', tamanho: 'sm', onClick: () => abrirClima(rdo) }) : null,
      ].filter(Boolean),
      conteudo: tabelaClima.elemento,
    }).elemento,
    blocoHorario));

  ['efetivo', 'equipamentos', 'atividades', 'ocorrencias', 'materiais', 'visitas'].forEach((s) => { if (blocoVisivel(s)) elementos.push(painelSecao(rdo, s)); });

  // fotos
  if (blocoVisivel('fotos')) {
    const entrada = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'ctc-hidden', onChange: (ev) => { const arqs = [...ev.target.files]; ev.target.value = ''; adicionarFotos(rdo.id, arqs); } });
    const grade = h('div', { class: 'ctc-grid ctc-grid--4' });
    (rdo.fotos || []).forEach((f) => {
      const img = h('img', { alt: f.legenda || 'Foto' });
      obterFoto(rdo.id, f.id).then((dados) => { if (dados) img.src = dados.mini || dados.dados; });
      grade.append(criarCard({ interativo: true, onClick: () => abrirFoto(rdo, f), conteudo: [img, h('div', { class: 'ctc-text-xs' }, f.legenda || h('span', { class: 'ctc-text-muted' }, 'sem legenda')), h('div', { class: 'ctc-text-xs ctc-text-muted' }, formatarData(f.tiradaEm, 'data-hora'))] }));
    });
    elementos.push(criarPainel({
      titulo: 'Fotos', icone: 'olho', tag: `${(rdo.fotos || []).length} de ${LIMITE_FOTOS}`,
      acoes: editavel ? [{ texto: 'Adicionar fotos', icone: 'mais', variante: 'primary', tamanho: 'sm', onClick: () => entrada.click() }] : [],
      conteudo: [(rdo.fotos || []).length ? grade : h('p', { class: 'ctc-text-sm ctc-text-muted' }, editavel ? 'Nenhuma foto. Toque em "Adicionar fotos" (no celular abre a câmera ou a galeria).' : 'Nenhuma foto.'), entrada],
    }).elemento);
  }

  if (blocoVisivel('comentarios')) {
    elementos.push(criarPainel({
      titulo: 'Comentários', icone: 'documento',
      acoes: editavel ? [{ texto: 'Editar', icone: 'editar', variante: 'outline', tamanho: 'sm', onClick: () => abrirComentarios(rdo) }] : [],
      conteudo: h('p', { class: 'ctc-text-sm' }, rdo.comentarios || h('span', { class: 'ctc-text-muted' }, 'Sem comentários.')),
    }).elemento);
  }

  // aprovacoes
  const ap = rdo.aprovacoes || {};
  const linhaAprov = (lado, rotulo) => {
    const a = ap[lado];
    return { lado: rotulo, quem: estado.aprovadores[lado] || 'não cadastrado', situacao: a ? `Aprovado por ${a.nome} em ${formatarData(a.em, 'data-hora')}` : 'Pendente', obs: a ? a.obs : '' };
  };
  elementos.push(criarPainel({
    titulo: 'Aprovação e assinaturas', icone: 'check', tag: estado.aprovadoresDoPortal ? 'aprovadores do Portal KZ' : 'aprovadores provisórios', semEspaco: true,
    conteudo: [
      criarTabela({
        colunas: [{ campo: 'lado', titulo: 'Lado', ordenavel: false }, { campo: 'quem', titulo: 'Aprovador (e-mail)', ordenavel: false }, { campo: 'situacao', titulo: 'Situação', ordenavel: false }, { campo: 'obs', titulo: 'Comentário', ordenavel: false }],
        dados: [linhaAprov('contratada', 'Contratada'), linhaAprov('contratante', 'Contratante')], porPagina: 0, altura: 'auto', compacta: true, camposBusca: [],
      }).elemento,
      h('p', { class: 'ctc-text-xs ctc-text-muted' }, 'Assinatura digital (D4Sign): será ligada quando o intermediário com as chaves da D4Sign estiver configurado. Até lá, vale a aprovação eletrônica registrada aqui (login do Portal KZ, data e hora).'),
    ],
  }).elemento);

  if ((rdo.adendos || []).length) {
    elementos.push(criarPainel({
      titulo: 'Adendos', icone: 'mais', tag: `${rdo.adendos.length}`, semEspaco: true,
      conteudo: criarTabela({ colunas: [{ campo: 'em', titulo: 'Data', formatar: (v) => formatarData(v, 'data-hora') }, { campo: 'autor', titulo: 'Autor' }, { campo: 'texto', titulo: 'Texto' }], dados: rdo.adendos, porPagina: 0, altura: 'auto', compacta: true }).elemento,
    }).elemento);
  }

  elementos.push(h('details', { class: 'ctc-explica' }, h('summary', {}, `🕘 Histórico (${(rdo.historico || []).length})`),
    criarTabela({ colunas: [{ campo: 'em', titulo: 'Quando', formatar: (v) => formatarData(v, 'data-hora') }, { campo: 'acao', titulo: 'O que' }, { campo: 'autor', titulo: 'Quem' }, { campo: 'obs', titulo: 'Observação' }], dados: [...(rdo.historico || [])].reverse(), porPagina: 0, altura: 'auto', compacta: true }).elemento));
  return elementos;
}

/* ---- Novo RDO ---- */
function abrirNovoRdo() {
  if (!podeEditarPerfil()) return;
  let sugestao = hojeIso();
  while (estado.rdos.has(idRdo(sugestao))) sugestao = somarDias(sugestao, 1);
  const ant = rdoAnterior(sugestao);
  const formulario = criarFormulario({
    colunas: 1, semBotoes: true, valores: { data: sugestao, copiar: Boolean(ant) },
    campos: [
      { nome: 'data', rotulo: 'Data do RDO', tipo: 'data', obrigatorio: true, regras: { validar: (v) => (estado.rdos.has(idRdo(v)) ? 'Já existe RDO nesta data.' : '') } },
      { nome: 'copiar', rotulo: 'Copiar do RDO anterior: efetivo, equipamentos, horário e atividades não concluídas', tipo: 'checkbox' },
    ],
    onEnviar: async (v) => {
      try {
        const rdo = await criarRdo(v.data, { copiar: v.copiar });
        ui.rdoAberto = rdo.id;
        modal.fechar();
        toast.sucesso(`Relatório nº ${rdo.numero} criado`, `${dataLonga(rdo.data)}. Tudo fica salvo neste aparelho na hora.`);
        aplicativo.navegar('editar');
      } catch (erro) { formulario.definirErro('data', erro.message); }
    },
  });
  const modal = criarModal({
    titulo: 'Novo RDO', tamanho: 'sm', destruirAoFechar: true,
    conteudo: [formulario.elemento, ant ? h('p', { class: 'ctc-text-xs ctc-text-muted' }, `RDO anterior: ${dataLonga(ant.data)}.`) : null],
    acoes: [{ texto: 'Cancelar', variante: 'outline' }, { texto: 'Criar RDO', variante: 'primary', fechar: false, onClick: () => formulario.enviar() }],
  });
  modal.abrir();
}
function abrirRdo(id) { ui.rdoAberto = id; aplicativo.navegar('rdo'); }

/* ---- Pagina: lista de RDOs ---- */
function paginaRdos() {
  const dados = listaRdos().reverse().map((r) => ({
    id: r.id, numero: r.numero, data: r.data, dia: diaSemana(r.data), status: r.status, statusTexto: STATUS_RDO[r.status].curto,
    clima: resumoClima(r), condicao: condicaoDoDia(r), efetivo: efetivoPresente(r), hh: homemHora(r),
    atividades: (r.atividades || []).length, ocorrencias: (r.ocorrencias || []).length, fotos: (r.fotos || []).length,
    autor: r.responsavel || r.criadoPor, mes: formatarData(r.data, 'mes-ano'), pendente: estado.pendentes.has(r.id) ? 'a enviar' : '',
  }));
  const tabela = criarTabela({
    colunas: [
      { campo: 'numero', titulo: 'Nº', tipo: 'numero', casas: 0 },
      { campo: 'data', titulo: 'Data', tipo: 'data' },
      { campo: 'dia', titulo: 'Dia' },
      { campo: 'status', titulo: 'Situação', render: (v, l) => h('span', { class: 'ctc-cluster' }, badgeStatus(v), l.pendente ? criarBadge({ texto: 'a enviar', variante: 'warning' }) : null) },
      { campo: 'condicao', titulo: 'Condição', render: (v) => criarBadge({ texto: v, variante: VARIANTE_CONDICAO[v] }) },
      { campo: 'clima', titulo: 'Clima (M / T / N)' },
      { campo: 'efetivo', titulo: 'Efetivo', tipo: 'numero', casas: 1 },
      { campo: 'hh', titulo: 'Homem-hora', tipo: 'numero', casas: 1, total: 'soma' },
      { campo: 'atividades', titulo: 'Ativid.', tipo: 'numero', casas: 0 },
      { campo: 'ocorrencias', titulo: 'Ocorr.', tipo: 'numero', casas: 0 },
      { campo: 'fotos', titulo: 'Fotos', tipo: 'numero', casas: 0 },
      { campo: 'autor', titulo: 'Responsável' },
    ],
    dados, porPagina: 31, compacta: true, ordenacao: { campo: 'data', direcao: 'desc' },
    linhaVariante: (l) => STATUS_RDO[l.status].linha,
    vazio: { titulo: 'Nenhum RDO ainda', mensagem: podeEditarPerfil() ? 'Crie o RDO do dia.' : 'Os RDOs da obra aparecem aqui.', acao: podeEditarPerfil() ? { texto: 'Novo RDO', variante: 'primary', onClick: abrirNovoRdo } : undefined },
    onLinhaClick: (l) => abrirRdo(l.id),
  });
  const filtros = criarBarraFiltros({
    busca: { placeholder: 'Pesquisar (data, atividade, responsável…)' },
    selects: [
      { campo: 'statusTexto', rotulo: 'Situação', opcoes: Object.values(STATUS_RDO).map((s) => s.curto) },
      { campo: 'mes', rotulo: 'Mês', opcoes: valoresUnicos(dados, 'mes', { ordenado: false }) },
      { campo: 'condicao', rotulo: 'Condição', opcoes: ['Praticável', 'Parcial', 'Impraticável', 'Sem registro'] },
    ],
    onMudar: (estadoFiltro) => tabela.atualizarConsulta(estadoFiltro),
  });
  return [criarPainel({ titulo: `RDOs da obra (${dados.length})`, icone: 'tabela', semEspaco: true, conteudo: [filtros.elemento, tabela.elemento] }).elemento];
}

/* ---- Pagina: aguardando a minha aprovacao ---- */
function rdosAguardandoMim() {
  return listaRdos().filter((r) => (r.status === 'enviado' && souAprovador('contratada')) || (r.status === 'em-aprovacao' && souAprovador('contratante')));
}
function paginaAprovacao() {
  const meus = rdosAguardandoMim();
  const todos = listaRdos().filter((r) => ['enviado', 'em-aprovacao'].includes(r.status));
  const tabela = (lista) => criarTabela({
    colunas: [{ campo: 'numero', titulo: 'Nº', tipo: 'numero', casas: 0 }, { campo: 'data', titulo: 'Data', tipo: 'data' }, { campo: 'status', titulo: 'Situação', render: (v) => badgeStatus(v) }, { campo: 'enviadoPor', titulo: 'Enviado por' }, { campo: 'enviadoEm', titulo: 'Enviado em', formatar: (v) => formatarData(v, 'data-hora') }],
    dados: lista, porPagina: 0, altura: 'auto', compacta: true,
    vazio: { titulo: 'Nada pendente', mensagem: '' }, onLinhaClick: (l) => abrirRdo(l.id),
  }).elemento;
  const souAlgum = souAprovador('contratada') || souAprovador('contratante');
  return [
    souAlgum ? null : criarAlerta({ tipo: 'info', titulo: 'Você não é aprovador desta obra', mensagem: `Aprovadores: contratada ${estado.aprovadores.contratada || '— não cadastrado'}; contratante ${estado.aprovadores.contratante || '— não cadastrado'}. ${estado.aprovadoresDoPortal ? 'Eles são definidos no Portal KZ, no controle RDO da obra.' : 'O Portal KZ ainda não tem os aprovadores desta obra: valem os provisórios da Configuração.'}` }),
    souAlgum ? criarPainel({ titulo: `Aguardando a minha aprovação (${meus.length})`, icone: 'check', semEspaco: true, conteudo: tabela(meus) }).elemento : null,
    criarPainel({ titulo: `Todos em aprovação (${todos.length})`, icone: 'tabela', semEspaco: true, conteudo: tabela(todos) }).elemento,
  ];
}

/* ---- Pagina: painel ---- */
function mesDoPainel() { return ui.mesPainel || formatarData(new Date(), 'iso-mes'); }
function calendarioMes(mesIso, visao) {
  const [a, m] = mesIso.split('-').map(Number);
  const primeiro = new Date(a, m - 1, 1);
  const diasNoMes = new Date(a, m, 0).getDate();
  const semanas = [];
  let semana = Array(7).fill(null);
  for (let d = 1; d <= diasNoMes; d += 1) {
    const data = new Date(a, m - 1, d);
    semana[data.getDay()] = formatarData(data, 'iso');
    if (data.getDay() === 6 || d === diasNoMes) { semanas.push(semana); semana = Array(7).fill(null); }
  }
  const celula = (iso) => {
    if (!iso) return '';
    const r = estado.rdos.get(idRdo(iso));
    const dia = String(Number(iso.slice(8)));
    let marca;
    if (visao === 'chuva') {
      const cond = r ? condicaoDoDia(r) : null;
      marca = r ? criarBadge({ texto: cond === 'Sem registro' ? '—' : cond.slice(0, 4), variante: VARIANTE_CONDICAO[cond] }) : null;
    } else {
      marca = r ? badgeStatus(r.status) : (iso <= hojeIso() && podeEditarPerfil() ? criarBadge({ texto: 'sem RDO', variante: 'neutral' }) : null);
    }
    return h('button', {
      type: 'button', class: 'ctc-btn ctc-btn--ghost ctc-btn--sm ctc-allow-readonly', title: r ? `RDO nº ${r.numero} — ${STATUS_RDO[r.status].texto}` : 'Sem RDO',
      onClick: () => { if (r) abrirRdo(r.id); else if (podeEditarPerfil() && iso <= hojeIso()) abrirNovoRdoNaData(iso); },
    }, h('b', {}, dia), marca);
  };
  const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return criarTabela({
    colunas: nomes.map((n, i) => ({ campo: `d${i}`, titulo: n, ordenavel: false, render: (v) => celula(v) })),
    dados: semanas.map((s) => Object.fromEntries(s.map((v, i) => [`d${i}`, v]))),
    porPagina: 0, altura: 'auto', compacta: true, grade: true, camposBusca: [],
  }).elemento;
}
function abrirNovoRdoNaData(iso) {
  abrirNovoRdo();
  setTimeout(() => {
    const campo = document.querySelector('.ctc-modal input[name="data"]');
    if (campo) { campo.value = iso; campo.dispatchEvent(new Event('change', { bubbles: true })); }
  }, 30);
}

function paginaPainel() {
  const rdos = listaRdos();
  const hoje = hojeIso();
  const p = prazoNaData(hoje);
  const mes = mesDoPainel();
  const doMes = rdos.filter((r) => r.data.startsWith(mes));
  const aguardando = rdos.filter((r) => ['enviado', 'em-aprovacao'].includes(r.status)).length;
  const rascunhos = rdos.filter((r) => ['rascunho', 'recusado'].includes(r.status)).length;
  const impraticaveis = rdos.filter((r) => condicaoDoDia(r) === 'Impraticável').length;
  const parciais = rdos.filter((r) => condicaoDoDia(r) === 'Parcial').length;
  const ultimos = rdos.slice(-30);
  const mediaEfetivo = ultimos.length ? ultimos.reduce((s, r) => s + efetivoPresente(r), 0) / ultimos.length : 0;
  const meus = rdosAguardandoMim();
  const temHoje = estado.rdos.has(idRdo(hoje));
  const c = estado.config;

  const avisos = [];
  if (!c.inicio || !c.prazoDias) avisos.push(criarAlerta({ tipo: 'warning', titulo: 'Prazo da obra não configurado', mensagem: ehAdministrador() ? 'Informe a data de início e o prazo em dias para o RDO mostrar "dia X de Y".' : 'Peça ao Administrador para informar o início e o prazo da obra.', acoes: ehAdministrador() ? [{ texto: 'Configurar', variante: 'primary', onClick: () => aplicativo.navegar('configuracao') }] : [] }));
  if (!estado.aprovadores.contratada || !estado.aprovadores.contratante) avisos.push(criarAlerta({ tipo: 'warning', titulo: 'Aprovadores incompletos', mensagem: 'Cadastre no Portal KZ o e-mail do aprovador da contratada e o do contratante (controle RDO da obra). Sem eles, os RDOs não podem ser aprovados.' }));
  if (meus.length) avisos.push(criarAlerta({ tipo: 'info', titulo: `${meus.length} RDO(s) aguardando a sua aprovação`, mensagem: meus.map((r) => formatarData(r.data)).join(', '), acoes: [{ texto: 'Ver', variante: 'primary', onClick: () => aplicativo.navegar('aprovacao') }] }));
  if (podeEditarPerfil() && !temHoje) avisos.push(criarAlerta({ tipo: 'info', titulo: 'O RDO de hoje ainda não foi criado', mensagem: dataLonga(hoje), acoes: [{ texto: 'Criar RDO de hoje', variante: 'primary', onClick: abrirNovoRdo }] }));

  const kpis = h('div', { class: 'ctc-grid ctc-grid--4' },
    kpi({ rotulo: 'Prazo contratual', valor: p && p.prazo ? `Dia ${p.dia} de ${p.prazo}` : '—', sub: p && p.termino ? `término ${formatarData(p.termino)}` : 'configure início e prazo', solido: true, progresso: p && p.prazo ? { percentual: Math.min(100, Math.max(0, (p.dia / p.prazo) * 100)) } : undefined }),
    kpi({ rotulo: 'Dias restantes', valor: p && p.restantes != null ? p.restantes : '—', formato: p && p.restantes != null ? 'numero' : undefined, casas: 0, variante: p && p.restantes != null && p.restantes < 0 ? 'danger' : 'accent', sub: p && p.restantes != null && p.restantes < 0 ? 'prazo vencido' : '' }),
    kpi({ rotulo: 'RDOs registrados', valor: rdos.length, formato: 'numero', casas: 0, sub: `${doMes.length} em ${formatarData(`${mes}-01`, 'mes-ano-longo')}` }),
    kpi({ rotulo: 'Aguardando aprovação', valor: aguardando, formato: 'numero', casas: 0, variante: aguardando ? 'warning' : 'success', sub: `${rascunhos} em rascunho / recusado` }),
    kpi({ rotulo: 'Dias impraticáveis', valor: impraticaveis, formato: 'numero', casas: 0, variante: impraticaveis ? 'danger' : 'success', sub: `${parciais} dia(s) parcialmente impraticável(is)` }),
    kpi({ rotulo: 'Efetivo médio', valor: mediaEfetivo, formato: 'numero', casas: 1, sub: `últimos ${ultimos.length} RDO(s)` }),
    kpi({ rotulo: 'Homem-hora acumulado', valor: rdos.reduce((s, r) => s + homemHora(r), 0), formato: 'numero', casas: 0, sub: 'todos os RDOs' }),
    kpi({ rotulo: 'Ocorrências', valor: rdos.reduce((s, r) => s + (r.ocorrencias || []).length, 0), formato: 'numero', casas: 0, sub: `${doMes.reduce((s, r) => s + (r.ocorrencias || []).length, 0)} no mês` }));

  const navegarMes = (delta) => { ui.mesPainel = formatarData(adicionarMeses(`${mes}-01`, delta), 'iso-mes'); aplicativo.navegar('painel'); };
  const visao = criarSegmentado({
    opcoes: [{ valor: 'situacao', texto: 'Situação dos RDOs' }, { valor: 'chuva', texto: 'Mapa de chuva' }], valor: ui.visaoCalendario,
    onMudar: (v) => { ui.visaoCalendario = v; aplicativo.navegar('painel'); },
  });
  const calendario = criarPainel({
    titulo: `Calendário — ${formatarData(`${mes}-01`, 'mes-ano-longo')}`, icone: 'calendario',
    acoes: [
      criarBotao({ texto: '◀', titulo: 'Mês anterior', variante: 'outline', tamanho: 'sm', classe: 'ctc-allow-readonly', onClick: () => navegarMes(-1) }),
      criarBotao({ texto: 'Hoje', variante: 'outline', tamanho: 'sm', classe: 'ctc-allow-readonly', onClick: () => { ui.mesPainel = null; aplicativo.navegar('painel'); } }),
      criarBotao({ texto: '▶', titulo: 'Próximo mês', variante: 'outline', tamanho: 'sm', classe: 'ctc-allow-readonly', onClick: () => navegarMes(1) }),
    ],
    conteudo: [visao.elemento, calendarioMes(mes, ui.visaoCalendario),
      h('p', { class: 'ctc-text-xs ctc-text-muted' }, ui.visaoCalendario === 'chuva'
        ? 'Mapa de chuva: Prát = praticável, Parc = parcialmente impraticável, Impr = impraticável (pelos turnos trabalhados). Use como base para pedido de prorrogação de prazo.'
        : 'Toque num dia para abrir o RDO (ou criar, se ainda não existe).')],
  }).elemento;

  const histograma = criarPainel({
    titulo: 'Histograma de efetivo', icone: 'grafico', tag: `últimos ${Math.min(20, rdos.length)} RDO(s) · presentes`,
    conteudo: rdos.length ? criarBarras({ itens: rdos.slice(-20).map((r) => ({ rotulo: `${formatarData(r.data).slice(0, 5)} ${diaSemana(r.data).slice(0, 3)}`, valor: efetivoPresente(r) })), formato: 'numero', casas: 1 }) : h('p', { class: 'ctc-text-sm ctc-text-muted' }, 'Sem RDOs ainda.'),
  }).elemento;

  // efetivo por funcao no mes
  const porFuncao = new Map();
  doMes.forEach((r) => (r.efetivo || []).filter((l) => l.presenca === 'Presente').forEach((l) => porFuncao.set(l.funcao || '—', (porFuncao.get(l.funcao || '—') || 0) + homemHoraLinha(l, r))));
  const funcoes = criarPainel({
    titulo: 'Homem-hora por função no mês', icone: 'usuario',
    conteudo: porFuncao.size ? criarBarras({ itens: [...porFuncao.entries()].sort((x, y) => y[1] - x[1]).map(([rotulo, valor]) => ({ rotulo, valor })), formato: 'numero', casas: 1, tema: 2 }) : h('p', { class: 'ctc-text-sm ctc-text-muted' }, 'Sem efetivo lançado no mês.'),
  }).elemento;

  return [...avisos, kpis, calendario, h('div', { class: 'ctc-grid ctc-grid--2' }, histograma, funcoes)];
}

/* ---- Pagina: relatorios ---- */
function paginaRelatorios() {
  const rdos = listaRdos();
  const formulario = criarFormulario({
    colunas: 3, semBotoes: true,
    valores: { de: rdos.length ? rdos[0].data : hojeIso(), ate: hojeIso(), fotos: 'sim', situacao: 'todos' },
    campos: [
      { nome: 'de', rotulo: 'De', tipo: 'data', obrigatorio: true },
      { nome: 'ate', rotulo: 'Até', tipo: 'data', obrigatorio: true },
      { nome: 'situacao', rotulo: 'RDOs', tipo: 'select', opcoes: [{ valor: 'todos', texto: 'Todos' }, { valor: 'aprovados', texto: 'Só aprovados' }] },
      { nome: 'fotos', rotulo: 'Modelo do PDF', tipo: 'radio', larguraTotal: true, opcoes: [{ valor: 'sim', texto: 'Completo (com fotos)' }, { valor: 'nao', texto: 'Sem fotos (mais leve)' }] },
    ],
  });
  const filtrar = () => {
    const v = formulario.obterValores();
    return rdos.filter((r) => r.data >= v.de && r.data <= v.ate && (v.situacao !== 'aprovados' || r.status === 'aprovado'));
  };
  return [
    criarPainel({
      titulo: 'PDF do período', icone: 'download',
      conteudo: [formulario.elemento, h('div', { class: 'ctc-toolbar' },
        criarBotao({ texto: 'Gerar PDF do período', icone: 'download', variante: 'primary', classe: 'ctc-allow-readonly', onClick: async (ev) => {
          const lista = filtrar();
          if (!lista.length) { toast.aviso('Nenhum RDO no período', 'Ajuste as datas.'); return; }
          await comCarregamento(ev.currentTarget, () => baixarPdfRdos(lista, { fotos: formulario.obterValores().fotos === 'sim', periodo: true }));
        } }),
        criarBotao({ texto: 'Exportar efetivo / homem-hora (Excel)', icone: 'download', variante: 'success', classe: 'ctc-allow-readonly', onClick: () => exportarEfetivoCsv(filtrar()) }),
        criarBotao({ texto: 'Exportar mapa de chuva (Excel)', icone: 'download', variante: 'success', classe: 'ctc-allow-readonly', onClick: () => exportarChuvaCsv(filtrar()) }),
        criarBotao({ texto: 'Exportar atividades (Excel)', icone: 'download', variante: 'success', classe: 'ctc-allow-readonly', onClick: () => exportarAtividadesCsv(filtrar()) }))],
    }).elemento,
    criarAlerta({ tipo: 'info', titulo: 'Sobre os arquivos', mensagem: 'O PDF de cada RDO também sai pela página do RDO (botões PDF e PDF sem fotos). Os arquivos Excel são CSV com separador ";" e abrem direto no Excel.' }),
  ];
}

function baixarCsv(nome, cabecalho, linhas) {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const numBr = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v);
  const texto = [cabecalho, ...linhas].map((l) => l.map((v) => esc(numBr(v))).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `${nome}_${estado.obra.sigla || estado.obra.id}_${hojeIso()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportarEfetivoCsv(lista) {
  const linhas = [];
  lista.forEach((r) => (r.efetivo || []).forEach((l) => linhas.push([formatarData(r.data), r.numero, l.empresa, l.funcao, l.nome || '', num(l.quantidade), l.presenca, Number(l.fracao) === 0.5 ? 'Meio dia' : 'Dia inteiro', homemHoraLinha(l, r), STATUS_RDO[r.status].curto])));
  baixarCsv('rdo-efetivo', ['Data', 'RDO', 'Empresa', 'Função', 'Nome', 'Quantidade', 'Presença', 'Jornada', 'Homem-hora', 'Situação do RDO'], linhas);
}
function exportarChuvaCsv(lista) {
  baixarCsv('rdo-mapa-de-chuva', ['Data', 'Dia', 'RDO', 'Manhã', 'Cond. manhã', 'Tarde', 'Cond. tarde', 'Noite', 'Cond. noite', 'Chuva (mm)', 'Condição do dia'],
    lista.map((r) => { const c = r.clima || {}; return [formatarData(r.data), diaSemana(r.data), r.numero, ...TURNOS.flatMap((t) => [(c[t.chave] || {}).tempo || '', (c[t.chave] || {}).condicao || '']), temValor(r.chuvaMm) ? num(r.chuvaMm) : '', condicaoDoDia(r)]; }));
}
function exportarAtividadesCsv(lista) {
  const linhas = [];
  lista.forEach((r) => (r.atividades || []).forEach((l) => linhas.push([formatarData(r.data), r.numero, l.servico, l.local || '', l.situacao, temValor(l.quantidade) ? num(l.quantidade) : '', l.unidade || '', temValor(l.avanco) ? num(l.avanco) : '', l.obs || ''])));
  baixarCsv('rdo-atividades', ['Data', 'RDO', 'Serviço', 'Local', 'Situação', 'Quantidade', 'Unidade', 'Avanço (%)', 'Observação'], linhas);
}

/* ---- Pagina: configuracao da obra (Administrador) ---- */
async function salvarConfig(nova, acao) {
  if (!exigirSinal('Alterar a configuração')) return false;
  const final = normalizarConfig({ ...estado.config, ...nova });
  try {
    await nuvemGravar('config', { ...final, atualizadoEm: agoraIso(), atualizadoPor: meuNome() });
    estado.config = final;
    estado.configPendente = false;
    await localGravar(chaveLocal('config'), final, false);
    aplicarAprovadores();
    toast.sucesso('Configuração salva', acao);
    return true;
  } catch (erro) { toast.erro('Não foi possível salvar', erro.message); return false; }
}

function paginaConfiguracao() {
  const c = estado.config;
  const somente = !ehAdministrador();
  const dados = criarFormulario({
    colunas: 3, textoEnviar: 'Salvar dados da obra',
    valores: { ...c },
    campos: [
      { nome: 'cliente', rotulo: 'Cliente / contratante', desabilitado: somente },
      { nome: 'contratada', rotulo: 'Contratada (empresa própria)', desabilitado: somente, dica: 'O efetivo dessa empresa conta como próprio' },
      { nome: 'contrato', rotulo: 'Nº do contrato', desabilitado: somente },
      { nome: 'endereco', rotulo: 'Endereço / local da obra', larguraTotal: true, desabilitado: somente },
      { nome: 'responsavel', rotulo: 'Responsável técnico', desabilitado: somente },
      { nome: 'inicio', rotulo: 'Início da obra (ordem de serviço)', tipo: 'data', desabilitado: somente },
      { nome: 'prazoDias', rotulo: 'Prazo contratual (dias corridos)', tipo: 'numero', regras: { minimo: 1, maximo: 9999 }, desabilitado: somente },
      { nome: 'horaInicio', rotulo: 'Horário padrão — início', regras: { validar: validarHora }, desabilitado: somente },
      { nome: 'horaFim', rotulo: 'Horário padrão — término', regras: { validar: validarHora }, desabilitado: somente },
      { nome: 'intervaloMin', rotulo: 'Intervalo padrão (min)', tipo: 'numero', regras: { minimo: 0, maximo: 600 }, desabilitado: somente },
      { nome: 'linkChuva', rotulo: 'Link do mapa de chuva da obra', larguraTotal: true, placeholder: 'https://…', desabilitado: somente, dica: 'Abre no bloco Clima do RDO (botão "Mapa de chuva")', regras: { validar: (v) => (!v || /^https?:\/\//i.test(v) ? '' : 'Comece com https://') } },
    ],
    onEnviar: async (v) => { if (somente) return; await salvarConfig(v, 'Dados da obra atualizados.'); aplicativo.navegar('configuracao'); },
  });

  const blocos = criarFormulario({
    colunas: 2, textoEnviar: 'Salvar blocos visíveis',
    valores: Object.fromEntries(BLOCOS.map((b) => [`bloco_${b.id}`, blocoVisivel(b.id)])),
    campos: BLOCOS.map((b) => ({ nome: `bloco_${b.id}`, rotulo: b.texto + (b.fixo ? ' (sempre visível)' : ''), tipo: 'checkbox', desabilitado: somente || b.fixo })),
    onEnviar: async (v) => {
      if (somente) return;
      const ocultos = BLOCOS.filter((b) => !b.fixo && !v[`bloco_${b.id}`]).map((b) => b.id);
      await salvarConfig({ blocosOcultos: ocultos }, 'Blocos do RDO atualizados.');
      aplicativo.navegar('configuracao');
    },
  });

  const cadastros = CADASTROS.map((cad) => {
    const itens = c.cadastros[cad.id] || [];
    const tabela = criarTabela({
      colunas: [{ campo: 'nome', titulo: 'Nome' }],
      dados: itens.map((nome) => ({ nome })), porPagina: 0, altura: 'auto', compacta: true,
      vazio: { titulo: 'Lista vazia', mensagem: '' },
      onLinhaClick: async (l) => {
        if (somente) return;
        const novo = await solicitarValor({ titulo: `${cad.texto} — editar`, rotulo: 'Nome (deixe em branco para excluir)', valor: l.nome, textoConfirmar: 'Salvar' });
        if (novo === null) return;
        const lista = itens.map((x) => (x === l.nome ? novo.trim() : x)).filter(Boolean);
        await salvarConfig({ cadastros: { ...c.cadastros, [cad.id]: [...new Set(lista)] } }, `${cad.texto}: lista atualizada.`);
        aplicativo.navegar('configuracao');
      },
    });
    return { id: cad.id, texto: `${cad.texto.split(' (')[0]} (${itens.length})`, conteudo: () => h('div', { class: 'ctc-stack' },
      somente ? null : h('div', { class: 'ctc-toolbar' }, criarBotao({ texto: 'Incluir vários', icone: 'mais', variante: 'primary', tamanho: 'sm', onClick: async () => {
        const texto = await solicitarValor({ titulo: `${cad.texto} — incluir`, rotulo: 'Um por linha (pode colar do Excel)', tipo: 'textarea', obrigatorio: true, textoConfirmar: 'Incluir' });
        if (!texto) return;
        const novos = String(texto).split(/\r?\n|;|\t/).map((x) => x.trim()).filter(Boolean);
        await salvarConfig({ cadastros: { ...c.cadastros, [cad.id]: [...new Set([...itens, ...novos])] } }, `${novos.length} item(ns) incluído(s).`);
        aplicativo.navegar('configuracao');
      } })),
      tabela.elemento) };
  });

  const portal = estado.aprovadoresDoPortal;
  const prov = criarFormulario({
    colunas: 2, textoEnviar: 'Salvar aprovadores provisórios', semBotoes: portal || somente,
    valores: portal ? { ...estado.aprovadores } : { ...c.aprovadoresProvisorios },
    campos: [
      { nome: 'contratada', rotulo: portal ? '🔒 1ª aprovação — Contratada (definido no Portal KZ)' : 'E-mail do aprovador da contratada (provisório)', tipo: 'email', desabilitado: somente || portal },
      { nome: 'contratante', rotulo: portal ? '🔒 2ª aprovação — Contratante (definido no Portal KZ)' : 'E-mail do aprovador do contratante (provisório)', tipo: 'email', desabilitado: somente || portal },
    ],
    onEnviar: async (v) => { if (somente || portal) return; await salvarConfig({ aprovadoresProvisorios: { contratada: v.contratada.toLowerCase(), contratante: v.contratante.toLowerCase() } }, 'Aprovadores provisórios salvos.'); aplicativo.navegar('configuracao'); },
  });

  return [
    somente ? criarAlerta({ tipo: 'info', titulo: 'Somente leitura', mensagem: 'Só o Administrador (papel Admin no Portal KZ) altera a configuração da obra.' }) : null,
    criarPainel({ titulo: 'Dados da obra e prazo', icone: 'configuracao', conteudo: dados.elemento }).elemento,
    painelIdentidade(),
    criarPainel({
      titulo: 'Aprovadores', icone: 'check', tag: portal ? 'definidos no Portal KZ' : 'Portal ainda sem aprovadores',
      conteudo: [
        criarAlerta({ tipo: portal ? 'success' : 'warning', mensagem: portal
          ? 'Os aprovadores vêm do Portal KZ e não podem ser alterados aqui. Para trocar, o gestor da obra usa o botão "Aprovadores" na linha do RDO, em Configurar controles. Os cargos ficam em "Identidade do relatório".'
          : 'O Portal KZ ainda não tem os aprovadores do RDO desta obra (o gestor cadastra no botão "Aprovadores" da linha do RDO, em Configurar controles). Enquanto isso, valem os e-mails abaixo (provisórios). A pessoa precisa ter login no Portal e papel Editor (ou Admin) no RDO para conseguir aprovar.' }),
        prov.elemento,
      ],
    }).elemento,
    criarPainel({ titulo: 'Blocos do RDO', icone: 'tabela', tag: 'oculte o que a obra não usa', conteudo: blocos.elemento }).elemento,
    criarPainel({ titulo: 'Cadastros (sugestões dos campos)', icone: 'tabela', tag: 'toque num item para editar ou excluir', conteudo: criarAbas({ abas: cadastros }).elemento }).elemento,
    criarPainel({ titulo: 'Assinatura digital — D4Sign', icone: 'documento', tag: 'em preparação', conteudo: h('p', { class: 'ctc-text-sm' }, 'Quando o intermediário seguro (com o tokenAPI e a cryptKey da sua conta D4Sign) estiver publicado, o RDO aprovado pela contratada será enviado automaticamente à D4Sign para as assinaturas da contratada e do contratante, e o PDF assinado ficará guardado no RDO. As chaves nunca ficam neste arquivo.') }).elemento,
  ];
}

/* ---- Pagina: sincronizacao ---- */
let pilulaSinc = null;
function atualizarPilulaSinc() {
  if (!pilulaSinc) return;
  const ponto = pilulaSinc.querySelector('.ctc-sinc-ponto');
  const texto = pilulaSinc.querySelector('span');
  let classe = 'is-ok'; let rotulo = estado.sync.ultimo ? `Em dia ${formatarData(estado.sync.ultimo, 'data-hora').slice(-5)}` : 'Em dia';
  if (ehDemo()) { classe = ''; rotulo = 'Demonstração'; }
  else if (estado.sync.erro) { classe = 'is-erro'; rotulo = 'Falha no envio'; }
  else if (!navigator.onLine) { classe = 'is-espera'; rotulo = totalPendente() ? `Sem sinal · ${totalPendente()} a enviar` : 'Sem sinal'; }
  else if (totalPendente()) { classe = 'is-espera'; rotulo = `${totalPendente()} a enviar`; }
  ponto.className = `ctc-sinc-ponto ${classe}`;
  texto.textContent = rotulo;
}
function paginaSincronizacao() {
  return [
    h('div', { class: 'ctc-grid ctc-grid--3' },
      kpi({ rotulo: 'Conexão', valor: navigator.onLine ? 'Com sinal' : 'Sem sinal', variante: navigator.onLine ? 'success' : 'warning' }),
      kpi({ rotulo: 'A enviar', valor: totalPendente(), formato: 'numero', casas: 0, variante: totalPendente() ? 'warning' : 'success', sub: `${estado.pendentes.size} RDO(s) · ${estado.fotosPendentes.size} foto(s)` }),
      kpi({ rotulo: 'Última sincronização', valor: estado.sync.ultimo ? formatarData(estado.sync.ultimo, 'data-hora') : '—' })),
    estado.sync.erro ? criarAlerta({ tipo: 'danger', titulo: 'Último envio falhou', mensagem: estado.sync.erro }) : null,
    criarAlerta({ tipo: 'info', titulo: 'Como funciona', mensagem: 'Tudo o que você lança fica guardado neste aparelho na hora, mesmo sem internet, e vai sozinho para a nuvem da obra quando há sinal. Aprovar, recusar, adendos e configuração precisam de internet. Se um RDO for aprovado na nuvem enquanto este aparelho estava sem sinal, vale a versão aprovada.' }),
    h('div', { class: 'ctc-toolbar' },
      criarBotao({ texto: 'Sincronizar agora', icone: 'download', variante: 'primary', classe: 'ctc-allow-readonly', onClick: async (ev) => { await comCarregamento(ev.currentTarget, async () => { await sincronizar(); await baixarDaNuvem().catch(() => {}); }); aplicativo.navegar('sincronizacao'); } })),
  ];
}

function abrirAjuda() {
  criarModal({
    titulo: 'Como usar o RDO', destruirAoFechar: true,
    conteudo: [
      criarAlerta({ tipo: 'info', titulo: '1. Crie o RDO do dia', mensagem: '"Novo RDO" (no Painel, na lista ou no calendário). Marque "Copiar do RDO anterior" para trazer efetivo, equipamentos, horário e atividades em andamento.' }),
      criarAlerta({ tipo: 'info', titulo: '2. Preencha os blocos', mensagem: 'Clima por turno (com o botão do mapa de chuva da obra), horário, efetivo, equipamentos, atividades, ocorrências, materiais, visitas, fotos e comentários. Toque numa linha para editar; tudo fica salvo neste aparelho na hora.' }),
      criarAlerta({ tipo: 'success', titulo: '3. Envie para aprovação', mensagem: 'O aprovador da contratada aprova (ou recusa com motivo); depois, o do contratante. Depois da primeira aprovação o RDO fica travado: correções só por adendo.' }),
      criarAlerta({ tipo: 'warning', titulo: 'Sem internet', mensagem: 'Pode preencher normalmente. O ponto no cabeçalho mostra o que falta enviar; o envio é automático quando o sinal volta.' }),
    ],
    acoes: [{ texto: 'Fechar', variante: 'primary' }],
  }).abrir();
}


/* =============================================================================
   08. PDF (gerador proprio: texto Helvetica + imagens JPEG, sem biblioteca externa;
       mesma base do Controle de Execucao em Campo)
   ========================================================================== */

const PDF_LARGURA = 595.28;
const PDF_ALTURA = 841.89;
const PDF_MARGEM = 36;
const PDF_LIMITE_INFERIOR = PDF_ALTURA - 56;
const PDF_CORES = {
  marca: '#1e3a5f', texto: '#0f172a', suave: '#64748b', borda: '#cbd5e1', fundo: '#f8fafc',
  verde: '#16a34a', verdeClaro: '#dcfce7', amarelo: '#ca8a04', amareloClaro: '#fef9c3',
  vermelho: '#dc2626', vermelhoClaro: '#fee2e2', azulClaro: '#e0f2fe', cinza: '#94a3b8', trilha: '#e2e8f0', branco: '#ffffff',
};
const medidorTextoPdf = document.createElement('canvas').getContext('2d');
function larguraTextoPdf(texto, tamanho, negrito) {
  medidorTextoPdf.font = `${negrito ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
  return (medidorTextoPdf.measureText(String(texto)).width / 100) * tamanho;
}
function ajustarTextoPdf(texto, largura, tamanho, negrito) {
  let t = String(texto ?? '');
  if (larguraTextoPdf(t, tamanho, negrito) <= largura) return t;
  while (t.length > 1 && larguraTextoPdf(`${t}…`, tamanho, negrito) > largura) t = t.slice(0, -1);
  return `${t}…`;
}
function literalPdf(texto) {
  const especiais = { '—': 151, '–': 150, '−': 45, '•': 149, '‘': 145, '’': 146, '“': 147, '”': 148, '…': 133, '³': 179, '²': 178, 'º': 186, 'ª': 170, '°': 176 };
  let saida = '';
  for (const ch of String(texto)) {
    let codigo = especiais[ch] ?? ch.codePointAt(0);
    if (codigo > 255) codigo = 63;
    if (codigo === 40 || codigo === 41 || codigo === 92) saida += `\\${ch}`;
    else if (codigo < 32 || codigo > 126) saida += `\\${codigo.toString(8).padStart(3, '0')}`;
    else saida += ch;
  }
  return `(${saida})`;
}
const semEmoji = (t) => String(t ?? '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️]/gu, '').trim();
const corPdf = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const numPdf = (n) => Number(n).toFixed(2);

function criarDocumentoPdf() {
  const paginas = [];
  const imagens = [];
  let atual = null;
  const doc = {
    paginas, imagens, y: 0, aoQuebrar: null,
    novaPagina() { atual = { ops: [] }; paginas.push(atual); doc.y = PDF_MARGEM; if (doc.aoQuebrar) doc.aoQuebrar(); },
    retangulo(x, y, l, a, { preenchimento, contorno, espessura = 0.6 } = {}) {
      if (preenchimento) atual.ops.push(`${corPdf(preenchimento)} rg`);
      if (contorno) atual.ops.push(`${corPdf(contorno)} RG ${numPdf(espessura)} w`);
      const op = preenchimento && contorno ? 'B' : (preenchimento ? 'f' : 'S');
      atual.ops.push(`${numPdf(x)} ${numPdf(PDF_ALTURA - y - a)} ${numPdf(l)} ${numPdf(a)} re ${op}`);
    },
    linha(x1, y1, x2, y2, cor = PDF_CORES.borda, espessura = 0.6) {
      atual.ops.push(`${corPdf(cor)} RG ${numPdf(espessura)} w ${numPdf(x1)} ${numPdf(PDF_ALTURA - y1)} m ${numPdf(x2)} ${numPdf(PDF_ALTURA - y2)} l S`);
    },
    texto(x, y, conteudo, { tamanho = 9, negrito = false, cor = PDF_CORES.texto, alinhar = 'esquerda' } = {}) {
      const t = semEmoji(conteudo);
      const largura = larguraTextoPdf(t, tamanho, negrito);
      const xFinal = alinhar === 'direita' ? x - largura : (alinhar === 'centro' ? x - largura / 2 : x);
      atual.ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tamanho} Tf ${corPdf(cor)} rg ${numPdf(xFinal)} ${numPdf(PDF_ALTURA - y)} Td ${literalPdf(t)} Tj ET`);
    },
    imagem(canvas, x, y, l, a) {
      const binario = atob(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
      const nome = `Im${imagens.length + 1}`;
      imagens.push({ nome, largura: canvas.width, altura: canvas.height, bytes });
      atual.ops.push(`q ${numPdf(l)} 0 0 ${numPdf(a)} ${numPdf(x)} ${numPdf(PDF_ALTURA - y - a)} cm /${nome} Do Q`);
    },
    garantir(altura) { if (doc.y + altura <= PDF_LIMITE_INFERIOR) return false; doc.novaPagina(); return true; },
  };
  return doc;
}

function montarBytesPdf({ paginas, imagens }) {
  const codificador = new TextEncoder();
  const partes = [];
  const deslocamentos = [];
  let posicao = 0;
  const escrever = (p) => { const b = typeof p === 'string' ? codificador.encode(p) : p; partes.push(b); posicao += b.length; };
  const objetos = [];
  const reservar = () => { objetos.push(null); return objetos.length; };
  const idCatalogo = reservar(); const idPaginas = reservar(); const idFonte = reservar(); const idFonteNegrito = reservar();
  const idsImagens = imagens.map(() => reservar());
  const idsPaginas = paginas.map(() => [reservar(), reservar()]);
  objetos[idCatalogo - 1] = [`<< /Type /Catalog /Pages ${idPaginas} 0 R >>`];
  objetos[idPaginas - 1] = [`<< /Type /Pages /Kids [${idsPaginas.map(([p]) => `${p} 0 R`).join(' ')}] /Count ${paginas.length} >>`];
  objetos[idFonte - 1] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  objetos[idFonteNegrito - 1] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  imagens.forEach((img, i) => {
    objetos[idsImagens[i] - 1] = [`<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`, img.bytes, '\nendstream'];
  });
  const recursoImagens = imagens.map((img, i) => `/${img.nome} ${idsImagens[i]} 0 R`).join(' ');
  paginas.forEach((pagina, i) => {
    const [idPagina, idConteudo] = idsPaginas[i];
    const conteudo = pagina.ops.join('\n');
    objetos[idPagina - 1] = [`<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 ${PDF_LARGURA} ${PDF_ALTURA}] /Resources << /Font << /F1 ${idFonte} 0 R /F2 ${idFonteNegrito} 0 R >> /XObject << ${recursoImagens} >> >> /Contents ${idConteudo} 0 R >>`];
    objetos[idConteudo - 1] = [`<< /Length ${codificador.encode(conteudo).length} >>\nstream\n${conteudo}\nendstream`];
  });
  escrever('%PDF-1.4\n');
  escrever(new Uint8Array([37, 226, 227, 207, 211, 10]));
  objetos.forEach((partesObjeto, i) => { deslocamentos.push(posicao); escrever(`${i + 1} 0 obj\n`); partesObjeto.forEach(escrever); escrever('\nendobj\n'); });
  const inicioXref = posicao;
  escrever(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`);
  deslocamentos.forEach((d) => escrever(`${String(d).padStart(10, '0')} 00000 n \n`));
  escrever(`trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  return new Blob(partes, { type: 'application/pdf' });
}

function quebrarTextoPdf(texto, largura, tamanho, maxLinhas = 60) {
  const linhas = [];
  String(semEmoji(texto) ?? '').split(/\n/).forEach((paragrafo) => {
    let atual = '';
    paragrafo.split(/\s+/).filter(Boolean).forEach((p) => {
      const teste = atual ? `${atual} ${p}` : p;
      if (larguraTextoPdf(teste, tamanho) <= largura || !atual) atual = teste;
      else { linhas.push(atual); atual = p; }
    });
    linhas.push(atual);
  });
  return linhas.slice(0, maxLinhas).map((l) => ajustarTextoPdf(l, largura, tamanho));
}

/** Tabela com quebra de pagina, cabecalho repetido e celulas com varias linhas (quebra: true). */
function tabelaPdf(doc, { colunas, linhas, total, x0 = PDF_MARGEM, tamanho = 7.8 }) {
  const largura = colunas.reduce((s, c) => s + c.largura, 0);
  const alturaCab = 16;
  const xTexto = (c, x) => (c.alinhar === 'direita' ? x + c.largura - 4 : (c.alinhar === 'centro' ? x + c.largura / 2 : x + 4));
  const cabecalho = () => {
    doc.retangulo(x0, doc.y, largura, alturaCab, { preenchimento: PDF_CORES.marca });
    let x = x0;
    colunas.forEach((c) => { doc.texto(xTexto(c, x), doc.y + 11, ajustarTextoPdf(c.titulo, c.largura - 6, tamanho - 0.4, true), { tamanho: tamanho - 0.4, negrito: true, cor: PDF_CORES.branco, alinhar: c.alinhar }); x += c.largura; });
    doc.y += alturaCab;
  };
  const linhaPdf = (valores, { negrito = false, fundo = null } = {}) => {
    const celulas = colunas.map((c, i) => {
      const v = valores[i];
      const t = v == null ? '' : String(v);
      return c.quebra ? quebrarTextoPdf(t, c.largura - 8, tamanho, 12) : [ajustarTextoPdf(t, c.largura - 8, tamanho, negrito)];
    });
    const nLinhas = Math.max(1, ...celulas.map((x) => x.length));
    const altura = 6 + nLinhas * (tamanho + 2.6);
    if (doc.garantir(altura)) cabecalho();
    if (fundo) doc.retangulo(x0, doc.y, largura, altura, { preenchimento: fundo });
    let x = x0;
    colunas.forEach((c, i) => {
      celulas[i].forEach((t, k) => doc.texto(xTexto(c, x), doc.y + 3 + (k + 1) * (tamanho + 2.6) - 2, t, { tamanho, negrito, alinhar: c.alinhar }));
      x += c.largura;
    });
    doc.y += altura;
    doc.linha(x0, doc.y, x0 + largura, doc.y);
  };
  if (doc.y + alturaCab + 30 > PDF_LIMITE_INFERIOR) doc.novaPagina();
  cabecalho();
  if (!linhas.length) linhaPdf(colunas.map((c, i) => (i === 0 ? 'Nada lançado.' : '')));
  linhas.forEach((l, i) => linhaPdf(l, { fundo: i % 2 ? PDF_CORES.fundo : null }));
  if (total) linhaPdf(total, { negrito: true, fundo: PDF_CORES.trilha });
  doc.y += 8;
}

/** Imagem (data URL) em canvas, para o PDF. */
async function canvasDeDataUrl(src) {
  const img = await carregarImagem(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c;
}

/** Gera o PDF de um ou varios RDOs (um por pagina; periodo com resumo na frente) e baixa. */
async function baixarPdfRdos(rdos, { fotos = true, periodo = false } = {}) {
  const doc = criarDocumentoPdf();
  const larguraUtil = PDF_LARGURA - 2 * PDF_MARGEM;
  const c = estado.config;
  const obraTexto = `${estado.obra.sigla ? `${estado.obra.sigla} — ` : ''}${estado.obra.nome || ''}`;
  let cabecalhoAtual = 'Relatório Diário de Obra';
  doc.aoQuebrar = () => {
    doc.retangulo(0, 0, PDF_LARGURA, 30, { preenchimento: PDF_CORES.marca });
    doc.texto(PDF_MARGEM, 19, cabecalhoAtual, { tamanho: 10, negrito: true, cor: PDF_CORES.branco });
    doc.texto(PDF_LARGURA - PDF_MARGEM, 19, ajustarTextoPdf(obraTexto, 280, 8.5), { tamanho: 8.5, cor: '#cbd5e1', alinhar: 'direita' });
    doc.y = 44;
  };
  const titulo = (texto, sub) => {
    doc.garantir(40);
    doc.retangulo(PDF_MARGEM, doc.y + 1, 3.5, 12, { preenchimento: PDF_CORES.marca });
    doc.texto(PDF_MARGEM + 9, doc.y + 11, texto, { tamanho: 10.5, negrito: true, cor: PDF_CORES.marca });
    if (sub) doc.texto(PDF_LARGURA - PDF_MARGEM, doc.y + 11, sub, { tamanho: 7.8, cor: PDF_CORES.suave, alinhar: 'direita' });
    doc.y += 18;
  };
  const caixaInfo = (pares, colunasCaixa = 3) => {
    const largura = larguraUtil / colunasCaixa;
    const linhasCaixa = Math.ceil(pares.length / colunasCaixa);
    const altura = linhasCaixa * 24 + 4;
    doc.garantir(altura + 6);
    doc.retangulo(PDF_MARGEM, doc.y, larguraUtil, altura, { preenchimento: PDF_CORES.fundo, contorno: PDF_CORES.borda });
    pares.forEach(([r, v], i) => {
      const x = PDF_MARGEM + (i % colunasCaixa) * largura + 7;
      const y = doc.y + Math.floor(i / colunasCaixa) * 24 + 4;
      doc.texto(x, y + 8, r, { tamanho: 6.8, cor: PDF_CORES.suave });
      doc.texto(x, y + 19, ajustarTextoPdf(temValor(v) ? v : '—', largura - 12, 8.6, true), { tamanho: 8.6, negrito: true });
    });
    doc.y += altura + 8;
  };
  const paragrafo = (texto, { tamanho = 8.4 } = {}) => {
    quebrarTextoPdf(texto, larguraUtil - 4, tamanho).forEach((l) => { doc.garantir(tamanho + 4); doc.texto(PDF_MARGEM + 2, doc.y + tamanho, l, { tamanho }); doc.y += tamanho + 3; });
    doc.y += 6;
  };

  // resumo do periodo
  if (periodo) {
    cabecalhoAtual = 'RDO — Resumo do período';
    doc.novaPagina();
    titulo(`Resumo do período: ${formatarData(rdos[0].data)} a ${formatarData(rdos[rdos.length - 1].data)}`, `${rdos.length} RDO(s)`);
    caixaInfo([['Obra', obraTexto], ['Cliente', c.cliente], ['Contrato', c.contrato],
      ['Dias impraticáveis', String(rdos.filter((r) => condicaoDoDia(r) === 'Impraticável').length)], ['Dias parciais', String(rdos.filter((r) => condicaoDoDia(r) === 'Parcial').length)],
      ['Homem-hora no período', formatarNumero(rdos.reduce((s, r) => s + homemHora(r), 0), 1)]]);
    tabelaPdf(doc, {
      colunas: [{ titulo: 'Nº', largura: 30, alinhar: 'centro' }, { titulo: 'Data', largura: 58, alinhar: 'centro' }, { titulo: 'Dia', largura: 62 }, { titulo: 'Clima (M / T / N)', largura: 130 }, { titulo: 'Condição', largura: 70 }, { titulo: 'Efetivo', largura: 45, alinhar: 'direita' }, { titulo: 'Hh', largura: 45, alinhar: 'direita' }, { titulo: 'Situação', largura: larguraUtil - 440 }],
      linhas: rdos.map((r) => [String(r.numero), formatarData(r.data), diaSemana(r.data), resumoClima(r), condicaoDoDia(r), formatarNumero(efetivoPresente(r), 1), formatarNumero(homemHora(r), 1), STATUS_RDO[r.status].curto]),
      total: ['', '', '', '', 'Total', '', formatarNumero(rdos.reduce((s, r) => s + homemHora(r), 0), 1), ''],
    });
  }

  for (const rdo of rdos) {
    cabecalhoAtual = `RELATÓRIO DIÁRIO DE OBRA — RDO nº ${rdo.numero} — ${formatarData(rdo.data)}`;
    doc.novaPagina();
    caixaInfo([
      ['Obra', obraTexto], ['Cliente / contratante', c.cliente], ['Contratada', c.contratada],
      ['Contrato', c.contrato], ['Data', dataLonga(rdo.data)], ['Prazo', textoPrazo(rdo.data)],
      ['Responsável pelo preenchimento', rdo.responsavel], ['Responsável técnico', c.responsavel], ['Situação', STATUS_RDO[rdo.status].texto],
    ]);
    if (c.endereco) { doc.texto(PDF_MARGEM, doc.y + 2, ajustarTextoPdf(`Local: ${c.endereco}`, larguraUtil, 7.6), { tamanho: 7.6, cor: PDF_CORES.suave }); doc.y += 10; }

    titulo('Clima e condição de trabalho', `${condicaoDoDia(rdo)}${temValor(rdo.chuvaMm) ? ` · ${formatarNumero(rdo.chuvaMm, 1)} mm` : ''}`);
    tabelaPdf(doc, {
      colunas: [{ titulo: 'Turno', largura: 100 }, { titulo: 'Tempo', largura: 160 }, { titulo: 'Condição', largura: larguraUtil - 260 }],
      linhas: TURNOS.map((t) => { const x = (rdo.clima || {})[t.chave] || {}; return [t.texto, x.tempo || '—', x.tempo === 'Não trabalhado' ? '—' : (x.condicao || '—')]; }),
    });
    if (blocoVisivel('horario')) {
      const hr = rdo.horario || {};
      titulo('Horário de trabalho', `${formatarNumero(jornadaHoras(rdo), 1)} h de jornada`);
      caixaInfo([['Início', hr.inicio], ['Término', hr.fim], ['Intervalo', temValor(hr.intervaloMin) ? `${hr.intervaloMin} min` : '—'], ['Horas paralisadas', temValor(hr.paralisacaoHoras) ? formatarNumero(hr.paralisacaoHoras, 1) : '—'], ['Motivo da paralisação', hr.paralisacaoMotivo], ['Jornada', `${formatarNumero(jornadaHoras(rdo), 1)} h`]], 3);
    }
    if (blocoVisivel('efetivo')) {
      const ept = efetivoPorTipo(rdo);
      titulo('Efetivo (mão de obra)', `presentes ${formatarNumero(efetivoPresente(rdo), 1)} (próprio ${formatarNumero(ept.proprio, 1)} · terceiros ${formatarNumero(ept.terceiros, 1)})`);
      tabelaPdf(doc, {
        colunas: [{ titulo: 'Empresa', largura: 105 }, { titulo: 'Função', largura: 105 }, { titulo: 'Nome', largura: 120 }, { titulo: 'Qtd.', largura: 32, alinhar: 'direita' }, { titulo: 'Presença', largura: 62 }, { titulo: 'Jornada', largura: 52 }, { titulo: 'Hh', largura: larguraUtil - 476, alinhar: 'direita' }],
        linhas: (rdo.efetivo || []).map((l) => [l.empresa, l.funcao, l.nome || '', formatarNumero(l.quantidade, 0), l.presenca, Number(l.fracao) === 0.5 ? 'Meio dia' : 'Dia inteiro', formatarNumero(homemHoraLinha(l, rdo), 1)]),
        total: (rdo.efetivo || []).length ? ['Total', '', '', formatarNumero((rdo.efetivo || []).reduce((s, l) => s + num(l.quantidade), 0), 0), '', '', formatarNumero(homemHora(rdo), 1)] : null,
      });
    }
    if (blocoVisivel('equipamentos')) {
      titulo('Equipamentos');
      tabelaPdf(doc, {
        colunas: [{ titulo: 'Equipamento', largura: 150 }, { titulo: 'Propriedade', largura: 70 }, { titulo: 'Qtd.', largura: 32, alinhar: 'direita' }, { titulo: 'Situação', largura: 80 }, { titulo: 'Horas', largura: 40, alinhar: 'direita' }, { titulo: 'Observação', largura: larguraUtil - 372, quebra: true }],
        linhas: (rdo.equipamentos || []).map((l) => [l.equipamento, l.propriedade, formatarNumero(l.quantidade, 0), l.situacao, temValor(l.horas) ? formatarNumero(l.horas, 1) : '', l.obs || '']),
      });
    }
    titulo('Atividades executadas');
    tabelaPdf(doc, {
      colunas: [{ titulo: 'Serviço', largura: 150, quebra: true }, { titulo: 'Local', largura: 80, quebra: true }, { titulo: 'Situação', largura: 64 }, { titulo: 'Qtd. no dia', largura: 62, alinhar: 'direita' }, { titulo: 'Avanço', largura: 40, alinhar: 'direita' }, { titulo: 'Observação', largura: larguraUtil - 396, quebra: true }],
      linhas: (rdo.atividades || []).map((l) => [l.servico, l.local || '', l.situacao, temValor(l.quantidade) ? `${formatarNumero(l.quantidade, 2)} ${l.unidade || ''}` : '', temValor(l.avanco) ? `${formatarNumero(l.avanco, 0)}%` : '', l.obs || '']),
    });
    if (blocoVisivel('ocorrencias')) {
      titulo('Ocorrências');
      tabelaPdf(doc, {
        colunas: [{ titulo: 'Tipo', largura: 100, quebra: true }, { titulo: 'Impacto', largura: 80 }, { titulo: 'Descrição', largura: larguraUtil - 290, quebra: true }, { titulo: 'Responsável', largura: 110, quebra: true }],
        linhas: (rdo.ocorrencias || []).map((l) => [l.tipo, l.impacto, l.descricao, l.responsavel || '']),
      });
    }
    if (blocoVisivel('materiais')) {
      titulo('Materiais recebidos');
      tabelaPdf(doc, {
        colunas: [{ titulo: 'Material', largura: 200, quebra: true }, { titulo: 'Quantidade', largura: 80, alinhar: 'direita' }, { titulo: 'Fornecedor', largura: 130 }, { titulo: 'NF / romaneio', largura: larguraUtil - 410 }],
        linhas: (rdo.materiais || []).map((l) => [l.material, temValor(l.quantidade) ? `${formatarNumero(l.quantidade, 2)} ${l.unidade || ''}` : '', l.fornecedor || '', l.documento || '']),
      });
    }
    if (blocoVisivel('visitas')) {
      titulo('Visitas e fiscalização');
      tabelaPdf(doc, {
        colunas: [{ titulo: 'Nome', largura: 130 }, { titulo: 'Empresa', largura: 120 }, { titulo: 'Horário', largura: 50, alinhar: 'centro' }, { titulo: 'Motivo', largura: larguraUtil - 300, quebra: true }],
        linhas: (rdo.visitas || []).map((l) => [l.nome, l.empresa || '', l.horario || '', l.motivo || '']),
      });
    }
    if (blocoVisivel('comentarios')) {
      titulo('Comentários');
      paragrafo(rdo.comentarios || 'Sem comentários.');
    }
    // fotos: 2 por linha
    if (fotos && blocoVisivel('fotos') && (rdo.fotos || []).length) {
      titulo('Registro fotográfico', `${rdo.fotos.length} foto(s)`);
      const larguraFoto = (larguraUtil - 12) / 2;
      for (let i = 0; i < rdo.fotos.length; i += 2) {
        const par = [];
        for (const f of rdo.fotos.slice(i, i + 2)) {
          const dados = await obterFoto(rdo.id, f.id);
          par.push({ f, canvas: dados ? await canvasDeDataUrl(dados.dados).catch(() => null) : null });
        }
        const altura = Math.max(...par.map((p) => (p.canvas ? (larguraFoto * p.canvas.height) / p.canvas.width : 60)));
        const alturaFinal = Math.min(altura, 250);
        doc.garantir(alturaFinal + 26);
        par.forEach((p, k) => {
          const x = PDF_MARGEM + k * (larguraFoto + 12);
          if (p.canvas) {
            let l = larguraFoto; let a = (larguraFoto * p.canvas.height) / p.canvas.width;
            if (a > alturaFinal) { l = (alturaFinal * p.canvas.width) / p.canvas.height; a = alturaFinal; }
            doc.imagem(p.canvas, x + (larguraFoto - l) / 2, doc.y, l, a);
          } else {
            doc.retangulo(x, doc.y, larguraFoto, alturaFinal, { contorno: PDF_CORES.borda });
            doc.texto(x + larguraFoto / 2, doc.y + alturaFinal / 2, 'Foto indisponível neste aparelho', { tamanho: 8, cor: PDF_CORES.suave, alinhar: 'centro' });
          }
          doc.texto(x, doc.y + alturaFinal + 10, ajustarTextoPdf(`${i + k + 1}. ${p.f.legenda || 'Sem legenda'}`, larguraFoto, 7.8), { tamanho: 7.8 });
        });
        doc.y += alturaFinal + 22;
      }
    } else if (!fotos && (rdo.fotos || []).length) {
      doc.texto(PDF_MARGEM, doc.y + 8, `${rdo.fotos.length} foto(s) registrada(s) — versão sem fotos.`, { tamanho: 7.8, cor: PDF_CORES.suave }); doc.y += 16;
    }
    if ((rdo.adendos || []).length) {
      titulo('Adendos (após a aprovação)');
      rdo.adendos.forEach((a) => { doc.garantir(24); doc.texto(PDF_MARGEM + 2, doc.y + 8, `${formatarData(a.em, 'data-hora')} — ${a.autor}`, { tamanho: 7.8, negrito: true }); doc.y += 12; paragrafo(a.texto); });
    }
    // aprovacoes / assinaturas
    titulo('Aprovação');
    doc.garantir(78);
    const larguraAss = (larguraUtil - 24) / 2;
    [['contratada', 'Contratada', c.contratada], ['contratante', 'Contratante', c.cliente]].forEach(([lado, rotulo, empresa], k) => {
      const x = PDF_MARGEM + k * (larguraAss + 24);
      const a = (rdo.aprovacoes || {})[lado];
      doc.retangulo(x, doc.y, larguraAss, 66, { preenchimento: a ? PDF_CORES.verdeClaro : PDF_CORES.fundo, contorno: a ? PDF_CORES.verde : PDF_CORES.borda });
      doc.texto(x + 8, doc.y + 13, `${rotulo}${empresa ? ` — ${empresa}` : ''}`, { tamanho: 8.6, negrito: true, cor: PDF_CORES.marca });
      if (a) {
        doc.texto(x + 8, doc.y + 28, ajustarTextoPdf(`Aprovado eletronicamente por ${a.nome}`, larguraAss - 16, 8), { tamanho: 8 });
        doc.texto(x + 8, doc.y + 40, ajustarTextoPdf(`${a.email} · ${formatarData(a.em, 'data-hora')}`, larguraAss - 16, 7.6), { tamanho: 7.6, cor: PDF_CORES.suave });
        if (a.obs) doc.texto(x + 8, doc.y + 53, ajustarTextoPdf(`"${a.obs}"`, larguraAss - 16, 7.4), { tamanho: 7.4, cor: PDF_CORES.suave });
      } else {
        doc.linha(x + 10, doc.y + 46, x + larguraAss - 10, doc.y + 46, PDF_CORES.texto, 0.6);
        doc.texto(x + larguraAss / 2, doc.y + 57, `Pendente · ${estado.aprovadores[lado] || 'aprovador não cadastrado'}`, { tamanho: 7.4, cor: PDF_CORES.suave, alinhar: 'centro' });
      }
    });
    doc.y += 76;
  }

  // rodape
  const agora = new Date();
  const total = doc.paginas.length;
  doc.paginas.forEach((pagina, i) => {
    pagina.ops.push(`${corPdf(PDF_CORES.borda)} RG 0.6 w ${numPdf(PDF_MARGEM)} ${numPdf(PDF_ALTURA - 810)} m ${numPdf(PDF_LARGURA - PDF_MARGEM)} ${numPdf(PDF_ALTURA - 810)} l S`);
    const esquerda = `RDO · ${obraTexto} · emitido em ${formatarData(agora, 'data-hora')} por ${meuNome()}${ehDemo() ? ' · DEMONSTRAÇÃO (dados fictícios)' : ''}`;
    const direita = `Página ${i + 1} de ${total}`;
    pagina.ops.push(`BT /F1 7 Tf ${corPdf(PDF_CORES.suave)} rg ${numPdf(PDF_MARGEM)} ${numPdf(PDF_ALTURA - 821)} Td ${literalPdf(ajustarTextoPdf(semEmoji(esquerda), 430, 7))} Tj ET`);
    pagina.ops.push(`BT /F1 7 Tf ${corPdf(PDF_CORES.suave)} rg ${numPdf(PDF_LARGURA - PDF_MARGEM - larguraTextoPdf(direita, 7))} ${numPdf(PDF_ALTURA - 821)} Td ${literalPdf(direita)} Tj ET`);
  });
  const arquivo = montarBytesPdf(doc);
  const sigla = (estado.obra.sigla || estado.obra.id || 'obra').replace(/[^\w-]+/g, '');
  const nome = rdos.length === 1
    ? `RDO_${sigla}_${String(rdos[0].numero).padStart(3, '0')}_${rdos[0].data}${fotos ? '' : '_sem-fotos'}.pdf`
    : `RDO_${sigla}_${rdos[0].data}_a_${rdos[rdos.length - 1].data}${fotos ? '' : '_sem-fotos'}.pdf`;
  const url = URL.createObjectURL(arquivo);
  const link = h('a', { href: url, download: nome });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  toast.sucesso('PDF gerado', `${nome} — ${total} página(s)`);
  return { nome, paginas: total, arquivo };
}


/* =============================================================================
   09. DEMONSTRACAO (dados ficticios, sem nuvem)
   ========================================================================== */

function montarDemonstracao() {
  // mantida enquanto a pagina estiver aberta: da para sair e entrar com outro perfil (ex.: aprovador)
  if (nuvemDemo.size) return;
  memoriaLocal.clear();
  const hoje = hojeIso();
  const inicio = somarDias(hoje, -40);
  const config = normalizarConfig({
    contrato: 'DEMO-001/2026', cliente: 'Cliente Fictício S.A.', contratada: 'CTC Infra', endereco: 'Endereço fictício, 100 — Cidade Demo',
    responsavel: 'Pessoa Fictícia 1 (Eng.)', inicio, prazoDias: 180, linkChuva: 'https://mapas.inmet.gov.br/',
    aprovadoresProvisorios: { contratada: 'contratada.demo@exemplo.com', contratante: 'contratante.demo@exemplo.com' },
    codigoDocumento: 'DEMO-CON-ENG-PLN-RDO', cargos: { contratada: 'Gerente do Contrato (fictício)', contratante: 'Engenheiro Fiscal (fictício)' },
    cadastros: {
      empresas: ['CTC Infra', 'Terceirizada Fictícia A', 'Locadora Fictícia B'],
      funcoes: ['Encarregado', 'Pedreiro', 'Armador', 'Carpinteiro', 'Servente', 'Operador de máquina', 'Técnico de segurança'],
      colaboradores: ['Pessoa Fictícia 2', 'Pessoa Fictícia 3', 'Pessoa Fictícia 4'],
      equipamentos: ['Retroescavadeira', 'Caminhão betoneira', 'Bomba de concreto', 'Vibrador de imersão', 'Gerador'],
      servicos: ['Escavação de blocos', 'Armação de blocos', 'Forma de blocos', 'Concretagem de blocos', 'Aterro compactado', 'Limpeza do canteiro'],
      locais: ['Bloco B1', 'Bloco B2', 'Bloco B3', 'Eixo 1 a 4', 'Canteiro'],
      unidades: UNIDADES_PADRAO,
    },
  });
  nuvemDemo.set('config', config);
  estado.config = config;
  const tempos = ['Bom', 'Bom', 'Nublado', 'Chuva fraca', 'Bom', 'Bom', 'Bom', 'Nublado', 'Chuva forte', 'Bom', 'Chuva fraca', 'Bom'];
  let numero = 0;
  for (let d = 12; d >= 1; d -= 1) {
    const data = somarDias(hoje, -d);
    const dataObj = paraData(data);
    if (dataObj.getDay() === 0) continue;
    numero += 1;
    const tempo = tempos[d % tempos.length];
    const impraticavel = tempo === 'Chuva forte';
    const status = d > 5 ? 'aprovado' : (d > 3 ? 'em-aprovacao' : (d === 3 ? 'enviado' : (d === 2 ? 'recusado' : 'rascunho')));
    const autor = 'Pessoa Fictícia 2';
    const rdo = {
      id: idRdo(data), data, numero, status, criadoEm: `${data}T08:00:00.000Z`, criadoPor: autor, criadoPorEmail: 'controlador.demo@exemplo.com',
      atualizadoEm: `${data}T18:00:00.000Z`, atualizadoPor: autor, responsavel: autor,
      clima: { manha: { tempo, condicao: impraticavel ? 'Impraticável' : 'Praticável' }, tarde: { tempo: tempo === 'Chuva fraca' ? 'Bom' : tempo, condicao: impraticavel ? 'Impraticável' : 'Praticável' }, noite: { tempo: 'Não trabalhado', condicao: 'Praticável' } },
      chuvaMm: tempo.startsWith('Chuva') ? (impraticavel ? 32 : 4) : null,
      horario: { inicio: '07:00', fim: dataObj.getDay() === 6 ? '12:00' : '17:00', intervaloMin: dataObj.getDay() === 6 ? 0 : 60, paralisacaoHoras: impraticavel ? 8 : null, paralisacaoMotivo: impraticavel ? 'Chuva forte (fictício)' : '' },
      efetivo: [
        { _id: gerarId('l'), empresa: 'CTC Infra', funcao: 'Encarregado', nome: 'Pessoa Fictícia 3', quantidade: 1, presenca: 'Presente', fracao: '1' },
        { _id: gerarId('l'), empresa: 'CTC Infra', funcao: 'Pedreiro', nome: '', quantidade: 4 + (d % 3), presenca: 'Presente', fracao: '1' },
        { _id: gerarId('l'), empresa: 'Terceirizada Fictícia A', funcao: 'Armador', nome: '', quantidade: 3 + (d % 2), presenca: 'Presente', fracao: d % 4 === 0 ? '0.5' : '1' },
        { _id: gerarId('l'), empresa: 'CTC Infra', funcao: 'Servente', nome: 'Pessoa Fictícia 4', quantidade: 1, presenca: d % 5 === 0 ? 'Atestado' : 'Presente', fracao: '1' },
      ],
      equipamentos: [
        { _id: gerarId('l'), equipamento: 'Retroescavadeira', propriedade: 'Locado', quantidade: 1, situacao: impraticavel ? 'Parado' : 'Trabalhando', horas: impraticavel ? 0 : 7 },
        { _id: gerarId('l'), equipamento: 'Gerador', propriedade: 'Próprio', quantidade: 1, situacao: 'À disposição', horas: null },
      ],
      atividades: impraticavel ? [] : [
        { _id: gerarId('l'), servico: 'Escavação de blocos', local: `Bloco B${(d % 3) + 1}`, situacao: d % 2 ? 'Concluída' : 'Em andamento', quantidade: 12 + d, unidade: 'm³', avanco: Math.min(100, 40 + (12 - d) * 5) },
        { _id: gerarId('l'), servico: 'Armação de blocos', local: 'Bloco B1', situacao: 'Em andamento', quantidade: 350 + d * 10, unidade: 'kg', avanco: 30 + (12 - d) * 4 },
      ],
      ocorrencias: impraticavel ? [{ _id: gerarId('l'), tipo: 'Chuva', impacto: 'Paralisação total', descricao: 'Chuva forte o dia todo; frentes paralisadas (registro fictício).', responsavel: '' }]
        : (d % 4 === 1 ? [{ _id: gerarId('l'), tipo: 'Falta de material', impacto: 'Atraso', descricao: 'Aço CA-50 Ø16 não entregue no horário (registro fictício).', responsavel: 'Fornecedor fictício' }] : []),
      materiais: d % 3 === 0 ? [{ _id: gerarId('l'), material: 'Aço CA-50 Ø16', quantidade: 2.5, unidade: 't', fornecedor: 'Terceirizada Fictícia A', documento: `NF DEMO-${100 + d}` }] : [],
      visitas: d % 5 === 0 ? [{ _id: gerarId('l'), nome: 'Pessoa Fictícia 5', empresa: 'Cliente Fictício S.A.', horario: '10:00', motivo: 'Visita de fiscalização (fictícia)' }] : [],
      fotos: [], comentarios: impraticavel ? 'Dia perdido por chuva (fictício).' : 'Serviços conforme a programação (fictício).',
      aprovacoes: { contratada: null, contratante: null }, adendos: [],
      historico: [{ acao: 'Criado', autor, em: `${data}T08:00:00.000Z` }],
    };
    if (['em-aprovacao', 'aprovado'].includes(status)) rdo.aprovacoes.contratada = { email: 'contratada.demo@exemplo.com', nome: 'Aprovador Fictício Contratada', em: `${data}T19:00:00.000Z`, obs: '' };
    if (status === 'aprovado') rdo.aprovacoes.contratante = { email: 'contratante.demo@exemplo.com', nome: 'Aprovador Fictício Contratante', em: `${somarDias(data, 1)}T09:00:00.000Z`, obs: 'De acordo.' };
    if (['enviado', 'em-aprovacao', 'aprovado'].includes(status)) { rdo.enviadoEm = `${data}T18:00:00.000Z`; rdo.enviadoPor = autor; }
    if (status === 'recusado') rdo.recusa = { lado: 'contratada', nome: 'Aprovador Fictício Contratada', email: 'contratada.demo@exemplo.com', em: `${data}T19:00:00.000Z`, motivo: 'Faltou lançar o efetivo da terceirizada (fictício).' };
    nuvemDemo.set(rdo.id, rdo);
  }
}


/* =============================================================================
   10. TELA DE ENTRADA E MONTAGEM DO APLICATIVO
   ========================================================================== */

function pedirLoginKZ() {
  return new Promise((resolver) => {
    let usuario = null;
    const formulario = criarFormulario({
      colunas: 1, semBotoes: true,
      campos: [
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true, atributos: { autocomplete: 'username' } },
        { nome: 'senha', rotulo: 'Senha', tipo: 'senha', obrigatorio: true, atributos: { autocomplete: 'current-password' } },
      ],
      onEnviar: async ({ email, senha }) => {
        try { const r = await KZ.entrar(email, senha); usuario = r && r.user ? r.user : await KZ.usuarioAtual(); modal.fechar(); }
        catch (erro) { formulario.definirErro('senha', erro.message); }
      },
    });
    const modal = criarModal({
      titulo: 'Entrar — login do Portal KZ', tamanho: 'sm', destruirAoFechar: true,
      conteudo: [h('p', { class: 'ctc-text-sm ctc-text-muted' }, 'Use o mesmo e-mail e senha do Portal KZ. O seu acesso ao RDO (Leitor, Editor ou Admin) é o liberado pelo gestor da obra.'), formulario.elemento],
      onFechar: () => resolver(usuario),
      acoes: [
        { texto: 'Esqueci a senha', variante: 'ghost', fechar: false, onClick: () => KZ.abrirEsqueciSenha(formulario.obterValores().email) },
        { texto: 'Cancelar', variante: 'outline' },
        { texto: 'Entrar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() },
      ],
    });
    modal.abrir();
  });
}

const linkEhDoRdo = (url) => /\/rdo(\/|$|[?#.-])/i.test(String(url || ''));

async function escolherObraKZ(user) {
  const perfil = await KZ.carregarPerfil(user);
  const obras = perfil.obras || [];
  if (!obras.length) throw new Error('Nenhuma obra liberada para este login. Fale com o gestor da obra.');
  const comControle = obras.filter((o) => Object.values(o.controles || {}).some((c) => linkEhDoRdo(c.url)));
  const lista = comControle.length ? comControle : obras;
  if (lista.length === 1) return lista[0].id;
  const rotulo = (o) => `${o.sigla ? `${o.sigla} — ` : ''}${o.nome || o.id}`;
  const escolha = await new Promise((resolver) => {
    let resposta = null;
    const formulario = criarFormulario({
      colunas: 1, semBotoes: true,
      campos: [{ nome: 'obra', rotulo: 'Obra', tipo: 'select', obrigatorio: true, opcoes: lista.map(rotulo) }],
      onEnviar: ({ obra: o }) => { resposta = o; modal.fechar(); },
    });
    const modal = criarModal({
      titulo: 'Qual obra?', tamanho: 'sm', destruirAoFechar: true, conteudo: formulario.elemento, onFechar: () => resolver(resposta),
      acoes: [{ texto: 'Cancelar', variante: 'outline' }, { texto: 'Continuar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() }],
    });
    modal.abrir();
  });
  if (escolha == null) return null;
  const obraEscolhida = lista.find((o) => rotulo(o) === escolha);
  return obraEscolhida ? obraEscolhida.id : null;
}

/** Login KZ, obra e papel no controle RDO (descobre o codigo do controle pelo link no Portal). */
async function conectarPortal({ pedirLogin = true, trocarObra = false } = {}) {
  await KZ.iniciarFirebase(FIREBASE_KZ);
  let user = await KZ.usuarioAtual();
  if (!user && pedirLogin) user = await pedirLoginKZ();
  if (!user) throw new Error('Login cancelado.');
  if (!obraUrl || trocarObra) {
    const escolhida = await escolherObraKZ(user);
    if (!escolhida) throw new Error('Nenhuma obra escolhida.');
    obraUrl = escolhida;
  }
  let acesso = await KZ.papelNaObra(obraUrl, LINK_CONTROLE_KZ);
  if (!acesso.obra) throw new Error(`A obra "${obraUrl}" não existe. Confira o link recebido.`);
  const controles = acesso.obra.controles || {};
  const id = Object.keys(controles).find((k) => linkEhDoRdo((controles[k] || {}).url)) || LINK_CONTROLE_KZ;
  if (id !== LINK_CONTROLE_KZ) acesso = await KZ.papelNaObra(obraUrl, id);
  if (!acesso.papel) throw new Error(`Seu usuário não tem acesso ao RDO na ${acesso.obra.sigla || obraUrl}. Fale com o gestor da obra.`);
  const ctrl = controles[id] || {};
  estado.modo = 'nuvem';
  estado.controle = id;
  estado.obra = { id: obraUrl, nome: acesso.obra.nome || obraUrl, sigla: acesso.obra.sigla || obraUrl.toUpperCase() };
  estado.usuario = { email: user.email, nome: acesso.nome, papel: acesso.papel };
  estado.aprovadoresPortal = { contratada: String((ctrl.aprovadores || {}).contratada || '').toLowerCase(), contratante: String((ctrl.aprovadores || {}).contratante || '').toLowerCase() };
  try { localStorage.setItem('kz-portal-obra', obraUrl); } catch (erro) { /* sem armazenamento */ }
  return estado.usuario;
}

/* ---- Tela de entrada ---- */
const telaEntrada = (() => {
  const elPortal = h('div', { class: 'ctc-entrada__portal' });
  const elAcessos = h('div', { class: 'ctc-ld-acessos' });
  const elBlocoAcessos = h('div', { class: 'ctc-entrada__bloco', hidden: true }, h('span', { class: 'ctc-entrada__rotulo' }, 'Como você vai acessar?'), elAcessos);
  const elDemo = h('div', { class: 'ctc-entrada__bloco', hidden: true });
  const cartao = ({ emoji, titulo, sub, dica, onClick }) => h('button', { type: 'button', class: 'ctc-ld-opc', title: dica || titulo, onClick },
    h('span', { class: 'ctc-ld-opc__ico', 'aria-hidden': 'true' }, emoji), h('b', {}, titulo), h('span', {}, sub));

  function mostrarConectado() {
    const u = estado.usuario;
    elPortal.classList.add('is-conectado');
    elPortal.replaceChildren(h('span', {}, '✅ ', h('b', {}, u.nome), ` · ${KZ.PAPEIS[u.papel] || u.papel} · obra ${estado.obra.sigla}`),
      h('button', { type: 'button', class: 'ctc-entrada__portal-btn', onClick: () => entrarNoPortal({ trocarObra: true }) }, 'Trocar obra'));
    const papel = u.papel;
    const souAprov = [estado.aprovadoresPortal.contratada, estado.aprovadoresPortal.contratante].includes(meuEmail());
    elAcessos.replaceChildren(
      cartao({ emoji: '👁️', titulo: 'Visualizador', sub: souAprov ? 'Consulta e aprova' : 'Consulta', dica: 'Somente leitura (aprovadores aprovam por aqui também)', onClick: () => entrar('visualizador') }),
      papel !== 'leitor' ? cartao({ emoji: '✏️', titulo: 'Controlador', sub: 'Preenche o RDO', dica: 'Cria, preenche e envia os RDOs', onClick: () => entrar('controlador') }) : null,
      papel === 'admin' ? cartao({ emoji: '🛡️', titulo: 'Administrador', sub: 'Tudo + configuração', dica: 'Também configura a obra e os cadastros', onClick: () => entrar('administrador') }) : null);
    elBlocoAcessos.hidden = false;
  }
  function mostrarDesconectado(mensagem) {
    elPortal.classList.remove('is-conectado');
    elPortal.replaceChildren(h('span', {}, mensagem || '🔑 Entre com o login do Portal KZ (mesmo e-mail e senha do painel).'),
      h('button', { type: 'button', class: 'ctc-entrada__portal-btn', onClick: () => entrarNoPortal() }, 'Entrar com o painel'));
    elBlocoAcessos.hidden = true;
  }
  async function entrarNoPortal(opcoes = {}) {
    try { await conectarPortal(opcoes); mostrarConectado(); }
    catch (erro) { if (!/cancelado|escolhida/i.test(erro.message)) toast.aviso('Login do Portal KZ', erro.message); if (!estado.usuario) mostrarDesconectado(); }
  }
  async function entrar(perfil) {
    estado.perfil = perfil;
    exigirAceitePrivacidade(() => abrirAplicativo());
  }
  function entrarDemo() {
    const perfis = [
      { valor: 'controlador', texto: 'Controlador (preenche e envia)', email: 'controlador.demo@exemplo.com', nome: 'Pessoa Fictícia 2', papel: 'editor' },
      { valor: 'administrador', texto: 'Administrador (configuração)', email: 'admin.demo@exemplo.com', nome: 'Pessoa Fictícia 1', papel: 'admin' },
      { valor: 'contratada', texto: 'Aprovador da contratada', email: 'contratada.demo@exemplo.com', nome: 'Aprovador Fictício Contratada', papel: 'editor', perfil: 'visualizador' },
      { valor: 'contratante', texto: 'Aprovador do contratante', email: 'contratante.demo@exemplo.com', nome: 'Aprovador Fictício Contratante', papel: 'editor', perfil: 'visualizador' },
      { valor: 'visualizador', texto: 'Visualizador', email: 'leitor.demo@exemplo.com', nome: 'Pessoa Fictícia 6', papel: 'leitor' },
    ];
    let resposta = null;
    const formulario = criarFormulario({
      colunas: 1, semBotoes: true, valores: { quem: 'controlador' },
      campos: [{ nome: 'quem', rotulo: 'Entrar na demonstração como', tipo: 'radio', opcoes: perfis.map((p) => ({ valor: p.valor, texto: p.texto })) }],
      onEnviar: ({ quem }) => { resposta = perfis.find((p) => p.valor === quem); modal.fechar(); },
    });
    const modal = criarModal({
      titulo: 'Demonstração (dados fictícios)', tamanho: 'sm', destruirAoFechar: true,
      conteudo: [h('p', { class: 'ctc-text-sm ctc-text-muted' }, 'Obra fictícia, sem login e sem nuvem: nada do que fizer aqui é gravado. Serve para treinar e conhecer o fluxo.'), formulario.elemento],
      onFechar: () => {
        if (!resposta) return;
        estado.modo = 'demo';
        estado.obra = { id: 'demo', nome: 'Obra Fictícia de Demonstração', sigla: 'DEMO' };
        estado.controle = 'rdo';
        estado.usuario = { email: resposta.email, nome: resposta.nome, papel: resposta.papel };
        estado.aprovadoresPortal = { contratada: '', contratante: '' };
        estado.perfil = resposta.perfil || PERFIL_DO_PAPEL[resposta.papel];
        montarDemonstracao();
        exigirAceitePrivacidade(() => abrirAplicativo());
      },
      acoes: [{ texto: 'Cancelar', variante: 'outline' }, { texto: 'Entrar', variante: 'primary', fechar: false, onClick: () => formulario.enviar() }],
    });
    modal.abrir();
  }
  elDemo.hidden = false;
  elDemo.append(h('button', { type: 'button', class: 'ctc-link ctc-text-xs', onClick: entrarDemo }, '▶ Ver a demonstração com dados fictícios (sem login)'));

  const elemento = h('div', { class: 'ctc-landing' },
    h('div', { class: 'ctc-landing__card ctc-entrada' },
      h('div', { class: 'ctc-landing__logo ctc-entrada__logo' }, conteudoLogo(MARCA.logo)),
      h('h1', { class: 'ctc-entrada__titulo' }, MARCA.titulo),
      h('p', { class: 'ctc-entrada__sub' }, 'Clima, efetivo, equipamentos, atividades, ocorrências e fotos do dia — com aprovação da contratada e do contratante.'),
      elPortal, elBlocoAcessos, elDemo,
      h('div', { class: 'ctc-entrada__links' },
        h('button', { type: 'button', onClick: () => abrirPrivacidade({ aba: 0 }) }, 'Privacidade'), ' · ',
        h('button', { type: 'button', onClick: () => abrirPrivacidade({ aba: 1 }) }, 'Termos de Uso')),
      h('div', { class: 'ctc-entrada__rodape' }, `RDO v${VERSAO_RDO} — acesso pelo login do Portal KZ`)));
  mostrarDesconectado();
  return {
    mostrar: () => { document.body.append(elemento); if (estado.usuario && !ehDemo()) mostrarConectado(); },
    remover: () => elemento.remove(),
    entrarNoPortal,
    mostrarDesconectado,
  };
})();

/* ---- v1.3.0: quem esta com o RDO aberto (iniciais no cabecalho, como no Excel) ----
   obras/{obra}/{controle}/config/presenca/{uid}, a cada 30 s. So Editor/Admin gravam (regras da nuvem). */
const CORES_PRESENCA = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#b45309', '#dc2626'];
function iniciaisDe(nome) {
  const partes = String(nome || '').replace(/@.*$/, '').split(/[\s._-]+/).filter((x) => x && !/^(da|de|do|das|dos|e)$/i.test(x));
  if (!partes.length) return '?';
  return ((partes[0][0] || '') + (partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || ''))).toUpperCase();
}
const corPresenca = (texto) => { let s = 0; for (const c of String(texto)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return CORES_PRESENCA[s % CORES_PRESENCA.length]; };
const presenca = { timer: null, redesenho: null, desligar: null, saiu: null };

async function iniciarPresenca(alvo) {
  pararPresenca();
  if (ehDemo() || !alvo || !estado.usuario) return;
  try {
    const { db, fs } = await firestore();
    const user = await KZ.usuarioAtual();
    if (!user) return;
    const col = fs.collection(db, ...caminhoControle(), 'config', 'presenca');
    const ref = fs.doc(col, user.uid);
    const grava = ['editor', 'admin'].includes(estado.usuario.papel);
    const entrouEm = agoraIso();
    const nome = meuNome();
    const bater = (saiu = false) => fs.setDoc(ref, { uid: user.uid, nome, email: meuEmail(), entrouEm, vistoEm: agoraIso(), saiu }).catch(() => {});
    if (grava) { bater(); presenca.timer = setInterval(() => { if (!document.hidden) bater(); }, 30000); }
    const recebido = new Map();
    let pessoas = [];
    const desenhar = () => {
      const agora = Date.now();
      const ativos = pessoas.filter((d) => d.uid !== user.uid && !d.saiu
        && Math.abs(agora - Date.parse(d.vistoEm || 0)) < 300000 && agora - (recebido.get(d.uid) || 0) < 90000)
        .sort((x, y) => String(x.entrouEm).localeCompare(String(y.entrouEm)));
      const hora = (iso) => { const dt = new Date(iso); return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
      const max = 5;
      alvo.replaceChildren(...[
        ...ativos.slice(0, max).map((d) => h('span', { class: 'rdo-presenca__av', style: { background: corPresenca(d.email || d.nome) }, title: `${d.nome} — com o RDO aberto desde ${hora(d.entrouEm)}` }, iniciaisDe(d.nome))),
        ativos.length > max ? h('span', { class: 'rdo-presenca__av rdo-presenca__mais', title: ativos.slice(max).map((d) => d.nome).join(', ') }, `+${ativos.length - max}`) : null,
      ].filter(Boolean));
      alvo.title = ativos.length ? `Com o RDO aberto agora: ${ativos.map((d) => d.nome).join(', ')}` : '';
    };
    presenca.desligar = fs.onSnapshot(col, (snap) => {
      snap.docChanges().forEach((m) => { if (m.type !== 'removed') recebido.set(m.doc.id, Date.now()); });
      pessoas = snap.docs.map((x) => x.data());
      desenhar();
    }, () => {});
    presenca.redesenho = setInterval(desenhar, 15000);
    presenca.saiu = () => { if (grava) bater(true); };
    window.addEventListener('pagehide', presenca.saiu);
  } catch (erro) { /* sem presenca: o RDO segue normal */ }
}

function pararPresenca() {
  clearInterval(presenca.timer); clearInterval(presenca.redesenho);
  if (presenca.desligar) presenca.desligar();
  if (presenca.saiu) { presenca.saiu(); window.removeEventListener('pagehide', presenca.saiu); }
  Object.assign(presenca, { timer: null, redesenho: null, desligar: null, saiu: null });
}

async function abrirAplicativo() {
  if (aplicativo) return;
  telaEntrada.remover();
  const car = mostrarCarregamento('nuvem', `${estado.obra.sigla} — RDO`, { logo: MARCA.logo, titulo: 'Carregando os RDOs da obra', etapas: ['Lendo o que está neste aparelho', 'Baixando da nuvem da obra', 'Conferindo aprovações', 'Calculando prazo e indicadores', 'Pronto'] });
  try { await carregarObra(); await car.fim(true); }
  catch (erro) { await car.fim(false, 'Não foi possível carregar tudo'); toast.aviso('Carregado só deste aparelho', erro.message); }

  pilulaSinc = h('button', { type: 'button', class: 'ctc-btn ctc-btn--outline ctc-btn--sm ctc-sinc-pilula ctc-allow-readonly', title: 'Sincronização', onClick: () => aplicativo.navegar('sincronizacao') },
    h('i', { class: 'ctc-sinc-ponto', 'aria-hidden': 'true' }), h('span', {}));
  const intervaloPilula = setInterval(atualizarPilulaSinc, 4000);
  const intervaloBusca = setInterval(buscarNovidades, 60000);   // v1.3.0
  const presencaEl = h('div', { class: 'rdo-presenca', 'aria-label': 'Quem está com o RDO aberto' });
  const sair = () => {
    clearInterval(intervaloPilula);
    clearInterval(intervaloBusca);
    pararPresenca();
    reiniciarAceitePrivacidade();
    app.destruir();
    aplicativo = null;
    pilulaSinc = null;
    ui.rdoAberto = null;
    if (ehDemo()) { estado.usuario = null; estado.modo = 'nuvem'; telaEntrada.mostrarDesconectado(); }
    telaEntrada.mostrar();
  };
  const aprovador = souAprovador('contratada') || souAprovador('contratante');
  const app = montarAplicativo({
    marca: { logo: MARCA.logo, titulo: 'RDO', subtitulo: estado.obra.sigla },
    cabecalho: {
      titulo: `RDO — ${estado.obra.sigla}${ehDemo() ? ' (demonstração)' : ''}`, subtitulo: estado.obra.nome,
      acoes: [podeEditarPerfil() ? { texto: 'Adicionar', icone: 'mais', variante: 'warning', onClick: abrirNovoRdo } : null, presencaEl, pilulaSinc, { texto: 'Ajuda', titulo: 'Ajuda', classe: 'ctc-btn--icone-tablet', icone: 'info', variante: 'outline', onClick: abrirAjuda }],
    },
    menu: {
      onNavegar: (id) => { if (id === 'privacidade') abrirPrivacidade({ aba: 0 }); if (id === 'novo') abrirNovoRdo(); },
      secoes: [
        { titulo: 'RDO', itens: [
          { id: 'visao', texto: 'Visão geral', emoji: '🏗️' },
          podeEditarPerfil() ? { id: 'novo', texto: 'Novo relatório', emoji: '➕' } : null,
          { id: 'rdos', texto: `Relatórios (${estado.rdos.size})`, emoji: '📋' },
          { id: 'rdo', texto: 'Relatório aberto', emoji: '📝' },
          { id: 'aprovacao', texto: aprovador ? 'Aguardando a minha aprovação' : 'Em aprovação', emoji: '✅' },
          { id: 'painel', texto: 'Análise de dados', emoji: '📊' },
          { id: 'relatorios', texto: 'Exportar (PDF e Excel)', emoji: '🖨️' },
        ].filter(Boolean) },
        { titulo: 'Sistema', itens: [
          { id: 'configuracao', texto: ehAdministrador() ? 'Configuração da obra' : 'Dados da obra', emoji: '⚙️' },
          { id: 'sincronizacao', texto: 'Sincronização', emoji: '🔄' },
          { id: 'privacidade', texto: 'Privacidade e Termos', emoji: '🛡️' },
        ] },
      ],
      rodape: `RDO v${VERSAO_RDO} · ${NOME_PERFIL[estado.perfil]}${ehDemo() ? ' · demonstração' : ''}`,
    },
    paginas: {
      visao: { titulo: 'Visão geral', caminho: [estado.obra.sigla], render: paginaVisaoGeral },
      painel: { titulo: 'Análise de dados', caminho: ['RDO'], render: paginaPainel },
      novo: { titulo: 'Novo relatório', caminho: ['RDO'], render: () => { setTimeout(abrirNovoRdo, 0); return paginaRelatoriosLista(); } },
      rdos: { titulo: 'Relatórios', caminho: ['RDO'], render: paginaRelatoriosLista },
      rdo: { titulo: 'Relatório', nomeCurto: 'Relatório aberto', caminho: ['RDO'], render: paginaRdo },
      editar: { titulo: 'Editar relatório', nomeCurto: 'Editando relatório', caminho: ['RDO'], render: paginaRdoEditar },
      aprovacao: { titulo: 'Aprovação', caminho: ['RDO'], render: paginaAprovacao },
      relatorios: { titulo: 'Relatórios', caminho: ['RDO'], render: paginaRelatorios },
      configuracao: { titulo: 'Configuração da obra', caminho: ['Sistema'], render: paginaConfiguracao },
      sincronizacao: { titulo: 'Sincronização', caminho: ['Sistema'], render: paginaSincronizacao },
    },
    paginaInicial: 'visao',
    usarHash: false,
    somenteLeitura: !podeEditarPerfil(),
    onSair: sair,
  });
  aplicativo = app;
  atualizarPilulaSinc();
  mostrarBoasVindas({ nome: meuNome(), perfil: NOME_PERFIL[estado.perfil], visualizador: estado.perfil === 'visualizador' && !aprovador, aplicativo: 'RDO — Relatório Diário de Obra', local: `${estado.obra.sigla} · ${estado.obra.nome}`, logo: MARCA.logo });
  if (totalPendente()) sincronizar({ silencioso: true });
  iniciarPresenca(presencaEl);
  window.ctcRdo = { estado, app, sincronizar, buscarNovidades };
}

telaEntrada.mostrar();

/* Aberto pelo Portal KZ (mesmo site e mesmo Firebase): quem ja esta logado nao digita a senha de novo. */
(async () => {
  try {
    await KZ.iniciarFirebase(FIREBASE_KZ);
    if (await KZ.usuarioAtual()) await telaEntrada.entrarNoPortal({ pedirLogin: false });
  } catch (erro) { /* sem login salvo: fica a tela de entrada */ }
})();

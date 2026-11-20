/* ---- Visual no modelo do Diario de Obra (v1.1.0) ---- */

/** Etiquetas cheias de situacao (Preenchendo / Revisar / Aprovado / Devolvido). */
const ETIQUETA = {
  rascunho: { texto: 'Preenchendo Relatório', curto: 'Preenchendo', classe: 'preenchendo' },
  recusado: { texto: 'Devolvido para correção', curto: 'Devolvido', classe: 'devolvido' },
  enviado: { texto: 'Revisar Relatório', curto: 'Revisar', classe: 'revisar', dica: 'Aguardando a 1ª aprovação (contratada)' },
  'em-aprovacao': { texto: 'Revisar Relatório', curto: 'Revisar', classe: 'revisar', dica: 'Aguardando a 2ª aprovação (contratante)' },
  aprovado: { texto: 'Aprovado', curto: 'Aprovado', classe: 'aprovado' },
};
function etiquetaStatus(status, { longa = false } = {}) {
  const e = ETIQUETA[status] || ETIQUETA.rascunho;
  return h('span', { class: 'rdo-cluster-inline' },
    h('span', { class: `rdo-st rdo-st--${e.classe}`, title: e.dica || e.texto }, longa ? e.texto : e.curto),
    status === 'aprovado' ? h('span', { class: 'rdo-st__check', title: 'Aprovado pela contratada e pelo contratante' }, '✓✓') : null,
    status === 'em-aprovacao' ? h('span', { class: 'rdo-mudo', title: '1ª aprovação feita' }, ' 1/2') : null);
}
const paginaRdoAtual = () => (aplicativo && aplicativo.paginaAtual() === 'editar' ? 'editar' : 'rdo');
const ICONE_TEMPO = { Bom: '☀️', Nublado: '⛅', 'Chuva fraca': '🌦️', 'Chuva forte': '🌧️', 'Não trabalhado': '—' };
const contadorFotos = (r) => ((r.fotos || []).length ? h('span', { class: 'rdo-mudo' }, `📷 ${(r.fotos || []).length}`) : '');

/** Miniatura (carrega deste aparelho ou da nuvem). */
function miniatura(rdo, foto, { grande = false } = {}) {
  const img = h('img', { alt: foto.legenda || 'Foto', title: foto.legenda || formatarData(foto.tiradaEm, 'data-hora'), onClick: (ev) => { ev.stopPropagation(); abrirFoto(rdo, foto); } });
  obterFoto(rdo.id, foto.id).then((f) => { if (f) img.src = grande ? (f.dados || f.mini) : (f.mini || f.dados); });
  return img;
}

/* ---- Visao geral ---- */
function paginaVisaoGeral() {
  const rdos = listaRdos();
  const c = estado.config;
  const hoje = hojeIso();
  const p = prazoNaData(hoje);
  const totalFotos = rdos.reduce((s, r) => s + (r.fotos || []).length, 0);
  const totalAtiv = rdos.reduce((s, r) => s + (r.atividades || []).length, 0);
  const totalOcorr = rdos.reduce((s, r) => s + (r.ocorrencias || []).length, 0);
  const totalComent = rdos.reduce((s, r) => s + (r.comentarios ? 1 : 0) + (r.adendos || []).length, 0);
  const meus = rdosAguardandoMim();

  const avisos = [];
  if (meus.length) avisos.push(criarAlerta({ tipo: 'info', titulo: `${meus.length} relatório(s) aguardando a sua aprovação`, mensagem: meus.map((r) => `nº ${r.numero} (${formatarData(r.data)})`).join(', '), acoes: [{ texto: 'Ver', variante: 'primary', onClick: () => aplicativo.navegar('aprovacao') }] }));
  if (podeEditarPerfil() && !estado.rdos.has(idRdo(hoje))) avisos.push(criarAlerta({ tipo: 'warning', titulo: 'O relatório de hoje ainda não foi criado', mensagem: dataLonga(hoje), acoes: [{ texto: '+ Criar relatório de hoje', variante: 'primary', onClick: abrirNovoRdo }] }));
  if (!c.inicio || !c.prazoDias) avisos.push(criarAlerta({ tipo: 'warning', titulo: 'Prazo da obra não configurado', mensagem: ehAdministrador() ? 'Informe a data de início e o prazo em dias na Configuração.' : 'Peça ao Administrador para informar o início e o prazo da obra.' }));

  const capa = h('div', { class: 'rdo-capa' },
    c.capa ? h('img', { class: 'rdo-capa__img', src: c.capa, alt: 'Foto da obra' }) : h('div', { class: 'rdo-capa__vazia' }, estado.obra.sigla || 'OBRA'),
    h('div', { class: 'rdo-capa__corpo' },
      h('div', { class: 'rdo-capa__nums' }, h('span', { title: 'Relatórios' }, `📋 ${rdos.length}`), h('span', { title: 'Fotos' }, `📷 ${totalFotos}`)),
      h('div', { class: 'rdo-capa__nome' }, estado.obra.nome || estado.obra.sigla),
      h('div', { class: 'rdo-capa__sub' }, [c.cliente, c.contrato ? `Contrato ${c.contrato}` : ''].filter(Boolean).join(' · ')),
      p && p.prazo ? h('div', { class: 'rdo-capa__sub' }, textoPrazo(hoje)) : null));

  const contador = (num, rotulo, icone, destino) => h(destino ? 'button' : 'div', { type: destino ? 'button' : null, class: 'rdo-cont', onClick: destino || null },
    h('div', {}, h('div', { class: 'rdo-cont__num' }, typeof num === 'number' ? formatarNumero(num, 0) : num), h('div', { class: 'rdo-cont__rot' }, rotulo)),
    h('span', { class: 'rdo-cont__ico', 'aria-hidden': 'true' }, icone));
  const contadores = h('div', { class: 'rdo-contadores' },
    contador(rdos.length, 'Relatórios', '📋', () => aplicativo.navegar('rdos')),
    contador(totalAtiv, 'Atividades', '☰'),
    contador(totalOcorr, 'Ocorrências', '⚠️'),
    contador(totalComent, 'Comentários', '💬'),
    contador(totalFotos, 'Fotos', '📷'),
    contador(p && p.prazo ? `${p.dia}/${p.prazo}` : '—', 'Dia do prazo', '⏱️'));

  // relatorios recentes
  const recentes = [...rdos].reverse().slice(0, 7);
  const tabela = h('table', { class: 'rdo-lista' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', {}, 'Nº'), h('th', {}, 'Status'), h('th', {}, 'Responsável'), h('th', {}, ''))),
    h('tbody', {}, recentes.map((r) => h('tr', {},
      h('td', {}, h('button', { type: 'button', class: 'rdo-link', onClick: () => abrirRdo(r.id) }, formatarData(r.data))),
      h('td', {}, h('button', { type: 'button', class: 'rdo-link', onClick: () => abrirRdo(r.id) }, String(r.numero))),
      h('td', {}, etiquetaStatus(r.status)),
      h('td', { class: 'rdo-mudo' }, r.responsavel || ''),
      h('td', { class: 'rdo-num' }, contadorFotos(r))))));
  const caixaRelatorios = h('div', { class: 'rdo-caixa' },
    h('div', { class: 'rdo-caixa__topo' }, h('span', { class: 'rdo-caixa__tit' }, 'Relatórios recentes'), h('button', { type: 'button', class: 'rdo-link', onClick: () => aplicativo.navegar('rdos') }, 'Ver tudo')),
    h('div', { class: 'rdo-caixa__corpo' }, recentes.length ? tabela : h('div', { class: 'rdo-vazio' }, 'Nenhum relatório ainda.')));

  // fotos recentes
  const fotos = [];
  [...rdos].reverse().forEach((r) => [...(r.fotos || [])].reverse().forEach((f) => { if (fotos.length < 12) fotos.push({ r, f }); }));
  const caixaFotos = h('div', { class: 'rdo-caixa' },
    h('div', { class: 'rdo-caixa__topo' }, h('span', { class: 'rdo-caixa__tit' }, 'Fotos recentes'), h('span', { class: 'rdo-mudo' }, `${totalFotos} foto(s) na obra`)),
    h('div', { class: 'rdo-caixa__corpo' }, fotos.length
      ? h('div', { class: 'rdo-mosaico' }, fotos.map(({ r, f }) => miniatura(r, f)))
      : h('div', { class: 'rdo-vazio' }, 'As fotos dos relatórios aparecem aqui.')));

  return [...avisos, h('div', { class: 'rdo-visao' }, capa, h('div', { class: 'ctc-stack' }, contadores, h('div', { class: 'rdo-dupla' }, caixaRelatorios, caixaFotos)))];
}

/* ---- Lista de relatorios ---- */
const filtroLista = { busca: '', status: '' };
function paginaRelatoriosLista() {
  const todos = [...listaRdos()].reverse();
  const conta = (classe) => todos.filter((r) => (ETIQUETA[r.status] || {}).classe === classe).length;
  const corpo = h('tbody', {});
  const desenhar = () => {
    const termo = normalizarTexto(filtroLista.busca || '');
    const lista = todos.filter((r) => (!filtroLista.status || (ETIQUETA[r.status] || {}).classe === filtroLista.status)
      && (!termo || normalizarTexto([formatarData(r.data), r.numero, r.responsavel, ETIQUETA[r.status].texto, ...(r.atividades || []).map((a) => a.servico), r.comentarios].join(' ')).includes(termo)));
    corpo.replaceChildren(...(lista.length ? lista.map((r) => h('tr', {},
      h('td', {}, h('button', { type: 'button', class: 'rdo-link', onClick: () => abrirRdo(r.id) }, formatarData(r.data))),
      h('td', {}, h('button', { type: 'button', class: 'rdo-link', onClick: () => abrirRdo(r.id) }, String(r.numero))),
      h('td', { class: 'rdo-mudo' }, diaSemana(r.data)),
      h('td', {}, `${(estado.config.codigoDocumento || 'RDO')}`),
      h('td', {}, h('span', { title: resumoClima(r) }, `${ICONE_TEMPO[((r.clima || {}).manha || {}).tempo] || ''} ${condicaoDoDia(r)}`)),
      h('td', {}, etiquetaStatus(r.status, { longa: true }), estado.pendentes.has(r.id) ? h('span', { class: 'rdo-mudo', title: 'Ainda não enviado para a nuvem' }, ' ⏳') : null),
      h('td', { class: 'rdo-num' }, contadorFotos(r)),
      h('td', { class: 'rdo-num' }, h('button', { type: 'button', class: 'rdo-acoes-btn', title: 'Ações', onClick: () => abrirAcoesRdo(r) }, '⋮'))))
      : [h('tr', {}, h('td', { colspan: 8, class: 'rdo-vazio' }, todos.length ? 'Nenhum relatório com esse filtro.' : 'Nenhum relatório ainda.'))]));
  };
  desenhar();
  const busca = h('input', { class: 'ctc-input', type: 'search', placeholder: 'Pesquisa (data, nº, atividade, responsável…)', value: filtroLista.busca, onInput: debounce((ev) => { filtroLista.busca = ev.target.value; desenhar(); }, 200) });
  const itemLegenda = (classe, texto, n) => h('button', { type: 'button', class: 'rdo-link rdo-legenda__item', title: 'Filtrar', onClick: () => { filtroLista.status = filtroLista.status === classe ? '' : classe; aplicativo.navegar('rdos'); } },
    h('span', { class: `rdo-legenda__ponto rdo-legenda__ponto--${classe}` }), h(filtroLista.status === classe ? 'b' : 'span', {}, `${texto} (${n})`));
  return [h('div', { class: 'rdo-caixa' },
    h('div', { class: 'rdo-caixa__topo' },
      h('span', { class: 'rdo-caixa__tit' }, filtroLista.status ? `Relatórios — ${ETIQUETA[{ preenchendo: 'rascunho', revisar: 'enviado', aprovado: 'aprovado', devolvido: 'recusado' }[filtroLista.status]].curto}` : 'Todos os relatórios'),
      h('div', { class: 'rdo-legenda' },
        itemLegenda('preenchendo', 'Preenchendo', conta('preenchendo')), itemLegenda('revisar', 'Revisar', conta('revisar')),
        itemLegenda('aprovado', 'Aprovado', conta('aprovado')), conta('devolvido') ? itemLegenda('devolvido', 'Devolvido', conta('devolvido')) : null,
        h('button', { type: 'button', class: 'rdo-acoes-btn', title: 'Imprimir a lista', onClick: () => window.print() }, '🖨️'))),
    h('div', { class: 'rdo-caixa__corpo' }, busca,
      h('div', { class: 'ctc-table-wrap ctc-table-wrap--auto' }, h('table', { class: 'rdo-lista' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', {}, 'Nº'), h('th', {}, 'Dia'), h('th', {}, 'Modelo de relatório'), h('th', {}, 'Clima'), h('th', {}, 'Status'), h('th', {}, ''), h('th', {}, ''))),
        corpo))))];
}

function abrirAcoesRdo(r) {
  const modal = criarModal({
    titulo: `Relatório nº ${r.numero} — ${formatarData(r.data)}`, tamanho: 'sm', destruirAoFechar: true,
    conteudo: h('div', { class: 'ctc-stack' },
      h('button', { type: 'button', class: 'rdo-btn rdo-btn--azul', onClick: () => { modal.fechar(); abrirRdo(r.id); } }, '👁️ Visualizar'),
      podeEditarRdo(r) ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--vermelho', onClick: () => { modal.fechar(); ui.rdoAberto = r.id; aplicativo.navegar('editar'); } }, '✏️ Editar') : null,
      h('button', { type: 'button', class: 'rdo-btn rdo-btn--cinza', onClick: async () => { modal.fechar(); await baixarPdfRdos([r], { fotos: true }); } }, '⬇️ Baixar PDF'),
      h('button', { type: 'button', class: 'rdo-btn rdo-btn--cinza', onClick: async () => { modal.fechar(); await baixarPdfRdos([r], { fotos: false }); } }, '⬇️ Baixar PDF sem fotos'),
      ehAdministrador() && ['rascunho', 'recusado'].includes(r.status) ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--escuro', onClick: () => { modal.fechar(); excluirRdo(r.id); } }, '🗑️ Excluir') : null),
    acoes: [{ texto: 'Fechar', variante: 'outline' }],
  });
  modal.abrir();
}

/* ---- Relatorio em formato de folha ---- */
function abrirHistorico(rdo) {
  criarModal({
    titulo: `Log de edições — nº ${rdo.numero}`, tamanho: 'lg', destruirAoFechar: true,
    conteudo: criarTabela({ colunas: [{ campo: 'em', titulo: 'Quando', formatar: (v) => formatarData(v, 'data-hora') }, { campo: 'acao', titulo: 'O que' }, { campo: 'autor', titulo: 'Quem' }, { campo: 'obs', titulo: 'Observação' }], dados: [...(rdo.historico || [])].reverse(), porPagina: 0, altura: 'auto', compacta: true }).elemento,
    acoes: [{ texto: 'Fechar', variante: 'primary' }],
  }).abrir();
}

function secaoFolha(titulo, n, conteudo, extra) {
  return h('div', { class: 'rdo-secao' },
    h('div', { class: 'rdo-secao__tit' }, h('b', {}, `${titulo} (${n})`), extra ? h('span', {}, extra) : null),
    n ? conteudo : null);
}

function paginaRdo() {
  const rdo = ui.rdoAberto ? estado.rdos.get(ui.rdoAberto) : null;
  if (!rdo) return [criarAlerta({ tipo: 'info', titulo: 'Nenhum relatório aberto', mensagem: 'Abra um relatório na lista ou crie o do dia.', acoes: [{ texto: 'Ver relatórios', variante: 'outline', onClick: () => aplicativo.navegar('rdos') }, podeEditarPerfil() ? { texto: '+ Novo relatório', variante: 'primary', onClick: abrirNovoRdo } : null].filter(Boolean) })];
  const c = estado.config;
  const p = prazoNaData(rdo.data);
  const editavel = podeEditarRdo(rdo);
  const td = (conteudo, at = {}) => h('td', at, conteudo);
  const th = (conteudo, at = {}) => h('th', at, conteudo);

  // topo
  const acoesTopo = [
    h('button', { type: 'button', class: 'rdo-btn rdo-btn--escuro', title: 'Log de edições', onClick: () => abrirHistorico(rdo) }, '☰'),
    h('button', { type: 'button', class: 'rdo-btn rdo-btn--cinza', onClick: () => window.print() }, '🖨️ Imprimir'),
    h('button', { type: 'button', class: 'rdo-btn rdo-btn--azul', onClick: (ev) => comCarregamento(ev.currentTarget, () => baixarPdfRdos([rdo], { fotos: true })) }, '⬇️ PDF'),
    editavel ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--verde', onClick: () => enviarRdo(rdo.id) }, '✔ Enviar para aprovação') : null,
    editavel ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--vermelho', onClick: () => aplicativo.navegar('editar') }, '✏️ Editar') : null,
    rdo.status === 'enviado' && podeEditarPerfil() ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--laranja', onClick: () => retirarEnvio(rdo.id) }, '↩ Retirar do envio') : null,
    travado(rdo) && (podeEditarPerfil() || souAprovador('contratada') || souAprovador('contratante')) ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--laranja', onClick: () => adicionarAdendo(rdo.id) }, '+ Adendo') : null,
  ];
  const topo = h('div', { class: 'rdo-topo' },
    h('button', { type: 'button', class: 'rdo-topo__voltar', title: 'Voltar à lista', onClick: () => aplicativo.navegar('rdos') }, '←'),
    h('div', { class: 'rdo-topo__tit' }, `Visualizar relatório: ${formatarData(rdo.data)} nº ${rdo.numero}`),
    h('div', { class: 'rdo-topo__acoes' }, ...acoesTopo));

  // cabecalho do documento
  const logos = ['contratante', 'contratada', 'outra'].map((k) => (c.logos || {})[k]).filter(Boolean);
  const blocoLogos = h('div', { class: 'rdo-logos' }, logos.length ? logos.map((src) => h('img', { src, alt: 'Logo' })) : [h('span', { class: 'rdo-logos__texto' }, c.contratada || 'CTC'), c.cliente ? h('span', { class: 'rdo-logos__texto' }, c.cliente) : null]);
  const cabecalho = h('table', { class: 'rdo-doc' }, h('tbody', {},
    h('tr', {}, td(blocoLogos, { colspan: 4, rowspan: 3 }), th('Relatório nº'), td(String(rdo.numero))),
    h('tr', {}, th('Data'), td(formatarData(rdo.data))),
    h('tr', {}, th('Dia da semana'), td(diaSemana(rdo.data).replace(/^./, (x) => x.toUpperCase()))),
    h('tr', {}, td(c.codigoDocumento || 'RELATÓRIO DIÁRIO DE OBRA — RDO', { colspan: 4, class: 'rdo-codigo' }), th('Nº do contrato'), td(c.contrato || '—')),
    h('tr', {}, th('Obra'), td(estado.obra.nome || estado.obra.sigla, { colspan: 3 }), th('Prazo contratual'), td(p && p.prazo ? `${p.prazo} dias` : '—')),
    h('tr', {}, th('Endereço'), td(c.endereco || '—', { colspan: 3 }), th('Prazo decorrido'), td(p ? `${p.dia} dias` : '—')),
    h('tr', {}, th('Contratante'), td(c.cliente || '—'), th('Responsável'), td(c.responsavel || rdo.responsavel || '—'), th('Prazo a vencer'), td(p && p.restantes != null ? `${p.restantes} dias` : '—'))));

  // horario, clima e chuva
  const hr = rdo.horario || {};
  const fimIntervalo = (() => { const ini = minutosDaHora('12:00'); const iv = num(hr.intervaloMin); return iv ? `${num(hr.intervaloMin)} min` : '—'; })();
  const horas = jornadaHoras(rdo);
  const tabHorario = h('table', { class: 'rdo-doc' }, h('tbody', {},
    h('tr', {}, th('Horário de trabalho', { colspan: 2 }), th('Hs. trabalhadas', { class: 'rdo-centro' })),
    h('tr', {}, th('Entrada / Saída'), td(`${hr.inicio || '—'} - ${hr.fim || '—'}`), td(`${String(Math.floor(horas)).padStart(2, '0')}:${String(Math.round((horas % 1) * 60)).padStart(2, '0')}`, { rowspan: 2, class: 'rdo-centro' })),
    h('tr', {}, th('Hs. intervalo'), td(fimIntervalo)),
    temValor(hr.paralisacaoHoras) && num(hr.paralisacaoHoras) ? h('tr', {}, th('Paralisação'), td(`${formatarNumero(hr.paralisacaoHoras, 1)} h${hr.paralisacaoMotivo ? ` — ${hr.paralisacaoMotivo}` : ''}`, { colspan: 2 })) : null));
  const turnos = TURNOS.filter((t) => ((rdo.clima || {})[t.chave] || {}).tempo && ((rdo.clima || {})[t.chave] || {}).tempo !== 'Não trabalhado');
  const tabClima = h('table', { class: 'rdo-doc' }, h('tbody', {},
    h('tr', {}, th('Clima'), th('Tempo'), th('Condição')),
    ...(turnos.length ? turnos.map((t) => { const x = rdo.clima[t.chave]; return h('tr', {}, th(t.texto), td(`${ICONE_TEMPO[x.tempo] || ''} ${x.tempo}`), td(x.condicao, { class: x.condicao === 'Impraticável' ? 'ctc-text-danger' : '' })); }) : [h('tr', {}, td('Sem turno trabalhado', { colspan: 3 }))])));
  const tabChuva = h('table', { class: 'rdo-doc' }, h('tbody', {},
    h('tr', {}, th('Índice pluviométrico')),
    h('tr', {}, td(temValor(rdo.chuvaMm) ? `${formatarNumero(rdo.chuvaMm, 1)} mm` : '—')),
    c.linkChuva ? h('tr', {}, td(h('a', { href: c.linkChuva, target: '_blank', rel: 'noopener', class: 'rdo-link' }, '🌧️ Mapa de chuva'))) : null));

  // mao de obra (agrupada por funcao + empresa)
  const propria = String(c.contratada || '').trim().toLowerCase();
  const grupos = new Map();
  (rdo.efetivo || []).filter((l) => l.presenca === 'Presente').forEach((l) => {
    const terceiro = String(l.empresa || '').trim().toLowerCase() !== propria;
    const chave = `${l.funcao}${terceiro && l.empresa ? ` - ${l.empresa}` : ''}`;
    grupos.set(chave, (grupos.get(chave) || 0) + num(l.quantidade) * (Number(l.fracao) || 1));
  });
  const ept = efetivoPorTipo(rdo);
  const ausentes = (rdo.efetivo || []).filter((l) => l.presenca !== 'Presente');
  const gradeMao = h('div', { class: 'rdo-grade' },
    ...[...grupos.entries()].map(([k, q]) => h('div', { class: 'rdo-grade__item' }, h('span', {}, k), h('b', {}, formatarNumero(q, q % 1 ? 1 : 0)))),
    h('div', { class: 'rdo-grade__item rdo-grade__item--total' }, h('span', {}, 'Próprio'), h('b', {}, formatarNumero(ept.proprio, ept.proprio % 1 ? 1 : 0))),
    h('div', { class: 'rdo-grade__item rdo-grade__item--total' }, h('span', {}, 'Terceiros'), h('b', {}, formatarNumero(ept.terceiros, ept.terceiros % 1 ? 1 : 0))));
  const secMao = blocoVisivel('efetivo') ? secaoFolha('Mão de obra', efetivoPresente(rdo), gradeMao,
    `${formatarNumero(homemHora(rdo), 1)} Hh${ausentes.length ? ` · ausentes: ${ausentes.map((l) => `${l.nome || l.funcao} (${l.presenca.toLowerCase()})`).join(', ')}` : ''}`) : null;

  // equipamentos
  const eq = new Map();
  (rdo.equipamentos || []).forEach((l) => { const k = l.equipamento; const a = eq.get(k) || { q: 0, sit: new Set() }; a.q += num(l.quantidade); a.sit.add(l.situacao); eq.set(k, a); });
  const secEq = blocoVisivel('equipamentos') ? secaoFolha('Equipamentos', [...eq.values()].reduce((s, a) => s + a.q, 0), h('div', { class: 'rdo-grade' },
    [...eq.entries()].map(([k, a]) => h('div', { class: 'rdo-grade__item' }, h('span', {}, k), h('b', {}, formatarNumero(a.q, 0)), [...a.sit].some((s) => s !== 'Trabalhando') ? h('small', {}, [...a.sit].join(', ')) : null)))) : null;

  // atividades com as fotos ligadas
  const fotosDa = (idAtiv) => (rdo.fotos || []).filter((f) => f.atividadeId === idAtiv);
  const secAtiv = secaoFolha('Atividades', (rdo.atividades || []).length, h('table', { class: 'rdo-ativ' }, h('tbody', {},
    (rdo.atividades || []).map((a) => h('tr', {},
      h('td', { class: 'rdo-ativ__desc' }, h('span', {}, a.servico), a.local ? h('span', { class: 'rdo-mudo' }, ` · ${a.local}`) : null, a.obs ? `\n${a.obs}` : ''),
      h('td', { class: 'rdo-ativ__qtd' }, temValor(a.quantidade) ? `${formatarNumero(a.quantidade, 2)} ${a.unidade || ''}` : '', temValor(a.avanco) ? h('div', { class: 'rdo-mudo' }, `${formatarNumero(a.avanco, 0)}% acumulado`) : null, temValor(a.pessoas) && num(a.pessoas) ? h('div', { class: 'rdo-mudo' }, `${a.pessoas} pessoa(s)`) : null),
      h('td', { class: 'rdo-ativ__sit' }, a.situacao, fotosDa(a._id).length ? h('div', { class: 'rdo-miniaturas' }, fotosDa(a._id).map((f) => miniatura(rdo, f))) : null))))));

  const listaTexto = (itens) => h('div', {}, itens.map(([titulo, texto]) => h('div', { class: 'rdo-texto' }, h('small', {}, titulo), texto)));
  const secOcorr = blocoVisivel('ocorrencias') ? secaoFolha('Ocorrências', (rdo.ocorrencias || []).length, listaTexto((rdo.ocorrencias || []).map((o) => [`${o.tipo} · ${o.impacto}${o.responsavel ? ` · ${o.responsavel}` : ''}`, o.descricao]))) : null;
  const secMat = blocoVisivel('materiais') ? secaoFolha('Materiais recebidos', (rdo.materiais || []).length, listaTexto((rdo.materiais || []).map((m) => [`${m.fornecedor || 'Fornecedor não informado'}${m.documento ? ` · ${m.documento}` : ''}`, `${m.material}${temValor(m.quantidade) ? ` — ${formatarNumero(m.quantidade, 2)} ${m.unidade || ''}` : ''}`]))) : null;
  const secVis = blocoVisivel('visitas') ? secaoFolha('Visitas', (rdo.visitas || []).length, listaTexto((rdo.visitas || []).map((v) => [`${v.horario || ''} ${v.empresa || ''}`.trim(), `${v.nome}${v.motivo ? ` — ${v.motivo}` : ''}`]))) : null;
  const comentarios = [...(rdo.comentarios ? [[`${rdo.responsavel || ''}`, rdo.comentarios]] : []), ...(rdo.adendos || []).map((a) => [`Adendo · ${a.autor} · ${formatarData(a.em, 'data-hora')}`, a.texto])];
  const secCom = secaoFolha('Comentários', comentarios.length, listaTexto(comentarios));
  const secFotos = blocoVisivel('fotos') ? secaoFolha('Fotos', (rdo.fotos || []).length, h('div', { class: 'rdo-fotos' },
    (rdo.fotos || []).map((f) => h('div', { class: 'rdo-foto' }, miniatura(rdo, f), f.legenda ? h('div', { class: 'rdo-foto__leg' }, f.legenda) : null)))) : null;

  // aprovacoes
  const caixaAprov = (lado, ordem) => {
    const a = (rdo.aprovacoes || {})[lado];
    const email = estado.aprovadores[lado] || 'aprovador não cadastrado';
    const cargo = ((c.cargos || {})[lado]) || (lado === 'contratada' ? 'Contratada' : 'Contratante');
    return h('div', { class: `rdo-aprov__box${a ? ' is-ok' : ''}` },
      h('div', { class: 'rdo-aprov__tit' }, `${ordem}ª aprovação`), h('div', {}, email),
      h('div', { class: 'rdo-aprov__linha' }),
      a ? h('div', {}, a.nome) : h('div', { class: 'rdo-mudo' }, 'Pendente'),
      a ? h('div', {}, a.email) : null,
      h('div', {}, cargo),
      a ? h('div', { class: 'rdo-aprov__ok' }, `✓ Aprovado em ${formatarData(a.em, 'data-hora')}`) : null,
      a && a.obs ? h('div', { class: 'rdo-mudo' }, `"${a.obs}"`) : null);
  };
  const acoesAprov = [];
  if (rdo.status === 'enviado' && souAprovador('contratada')) acoesAprov.push(h('button', { type: 'button', class: 'rdo-btn rdo-btn--verde', onClick: () => aprovarRdo(rdo.id, 'contratada') }, '✔ Aprovar (1ª)'), h('button', { type: 'button', class: 'rdo-btn rdo-btn--vermelho', onClick: () => recusarRdo(rdo.id, 'contratada') }, '↩ Devolver para correção'));
  if (rdo.status === 'em-aprovacao' && souAprovador('contratante')) acoesAprov.push(h('button', { type: 'button', class: 'rdo-btn rdo-btn--verde', onClick: () => aprovarRdo(rdo.id, 'contratante') }, '✔ Aprovar (2ª)'), h('button', { type: 'button', class: 'rdo-btn rdo-btn--vermelho', onClick: () => recusarRdo(rdo.id, 'contratante') }, '↩ Devolver para correção'));
  const textoAviso = {
    rascunho: 'Envie o relatório ("Enviar para aprovação") para liberar a aprovação.',
    recusado: rdo.recusa ? `Devolvido pela ${rdo.recusa.lado} (${rdo.recusa.nome}, ${formatarData(rdo.recusa.em, 'data-hora')}): ${rdo.recusa.motivo}` : 'Devolvido para correção.',
    enviado: 'Aguardando a 1ª aprovação (contratada).',
    'em-aprovacao': 'Aguardando a 2ª aprovação (contratante). O conteúdo está travado.',
    aprovado: 'Relatório aprovado pelos dois lados. Correções só por adendo.',
  }[rdo.status];

  // anterior / proximo
  const ordenados = listaRdos();
  const pos = ordenados.findIndex((r) => r.id === rdo.id);
  const ant = ordenados[pos - 1]; const prox = ordenados[pos + 1];
  const nav = h('div', { class: 'rdo-nav' },
    ant ? h('button', { type: 'button', class: 'rdo-nav__btn', onClick: () => abrirRdo(ant.id) }, h('span', {}, '←'), h('span', {}, 'Anterior', h('br'), formatarData(ant.data))) : h('span'),
    prox ? h('button', { type: 'button', class: 'rdo-nav__btn rdo-nav__btn--dir', onClick: () => abrirRdo(prox.id) }, h('span', {}, '→'), h('span', {}, 'Próximo', h('br'), formatarData(prox.data))) : null);

  const folha = h('div', { class: 'rdo-folha' },
    h('div', {}, etiquetaStatus(rdo.status, { longa: true }), estado.pendentes.has(rdo.id) ? h('span', { class: 'rdo-mudo' }, '  ⏳ ainda não enviado para a nuvem') : null),
    cabecalho,
    h('div', { class: 'rdo-tres' }, blocoVisivel('horario') ? tabHorario : h('div'), tabClima, tabChuva),
    secMao, secEq, secAtiv, secOcorr, secMat, secVis, secCom, secFotos,
    h('div', { class: 'rdo-aprov' }, caixaAprov('contratada', 1), caixaAprov('contratante', 2)),
    h('div', { class: 'rdo-aviso' }, textoAviso),
    acoesAprov.length ? h('div', { class: 'rdo-topo__acoes rdo-sem-impressao' }, ...acoesAprov) : null,
    nav);
  const rodape = h('div', { class: 'rdo-rodape' },
    h('div', {}, h('div', {}, h('b', {}, 'Criado por: '), `${rdo.criadoPor || '—'} ( ${formatarData(rdo.criadoEm, 'data-hora')} )`),
      h('div', {}, h('b', {}, 'Última modificação: '), `${rdo.atualizadoPor || '—'} ( ${formatarData(rdo.atualizadoEm, 'data-hora')} )`)),
    h('div', { class: 'rdo-rodape__links' }, h('button', { type: 'button', class: 'rdo-link', onClick: () => abrirHistorico(rdo) }, `Log de edições (${(rdo.historico || []).length})`)));
  return [topo, folha, rodape];
}

/** Configuracao: logos, foto da obra, codigo do documento e cargos dos aprovadores. */
function painelIdentidade() {
  const c = estado.config;
  const somente = !ehAdministrador();
  const escolherImagem = (chave, rotulo, ladoMaximo) => {
    const entrada = h('input', { type: 'file', accept: 'image/*', class: 'ctc-hidden', onChange: async (ev) => {
      const arq = ev.target.files[0]; ev.target.value = '';
      if (!arq) return;
      try {
        const dados = await lerImagemComoDataURL(arq, { ladoMaximo, tamanhoMaximoMB: 10 });
        const nova = chave === 'capa' ? { capa: dados } : { logos: { ...(c.logos || {}), [chave]: dados } };
        await salvarConfig(nova, `${rotulo} atualizada.`);
        aplicativo.navegar('configuracao');
      } catch (erro) { toast.erro('Imagem não aproveitada', erro.message); }
    } });
    const atual = chave === 'capa' ? c.capa : (c.logos || {})[chave];
    return h('div', { class: 'rdo-caixa' },
      h('div', { class: 'rdo-caixa__topo' }, h('b', {}, rotulo)),
      h('div', { class: 'rdo-caixa__corpo ctc-stack' },
        atual ? h('div', { class: 'rdo-logos' }, h('img', { src: atual, alt: rotulo })) : h('div', { class: 'rdo-vazio' }, 'Sem imagem.'),
        somente ? null : h('div', { class: 'ctc-cluster' },
          h('button', { type: 'button', class: 'rdo-btn rdo-btn--azul', onClick: () => entrada.click() }, atual ? 'Trocar' : 'Escolher imagem'),
          atual ? h('button', { type: 'button', class: 'rdo-btn rdo-btn--cinza', onClick: async () => { await salvarConfig(chave === 'capa' ? { capa: '' } : { logos: { ...(c.logos || {}), [chave]: '' } }, `${rotulo} removida.`); aplicativo.navegar('configuracao'); } }, 'Remover') : null),
        entrada));
  };
  const form = criarFormulario({
    colunas: 3, textoEnviar: 'Salvar código e cargos',
    valores: { codigoDocumento: c.codigoDocumento || '', cargoContratada: (c.cargos || {}).contratada || '', cargoContratante: (c.cargos || {}).contratante || '' },
    campos: [
      { nome: 'codigoDocumento', rotulo: 'Código / modelo do relatório', placeholder: 'Ex.: WS-F3-CON-ENG-PLC-PLN-RDO', desabilitado: somente },
      { nome: 'cargoContratada', rotulo: 'Cargo do aprovador da contratada', placeholder: 'Ex.: Gerente do Contrato', desabilitado: somente },
      { nome: 'cargoContratante', rotulo: 'Cargo do aprovador do contratante', placeholder: 'Ex.: Engenheiro Fiscal', desabilitado: somente },
    ],
    onEnviar: async (v) => { if (somente) return; await salvarConfig({ codigoDocumento: v.codigoDocumento, cargos: { contratada: v.cargoContratada, contratante: v.cargoContratante } }, 'Código e cargos salvos.'); aplicativo.navegar('configuracao'); },
  });
  return criarPainel({
    titulo: 'Identidade do relatório', icone: 'documento', tag: 'logos, foto da obra, código',
    conteudo: [h('div', { class: 'ctc-grid ctc-grid--4' },
      escolherImagem('contratante', 'Logo do contratante', 400), escolherImagem('contratada', 'Logo da contratada', 400),
      escolherImagem('outra', 'Outro logo (gerenciadora…)', 400), escolherImagem('capa', 'Foto da obra (capa)', 900)), form.elemento],
  }).elemento;
}

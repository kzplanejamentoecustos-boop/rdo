"""Monta o RDO em um arquivo unico:
   base-kz.html (biblioteca CTC/KZ congelada) + rdo.css (estilos do RDO) + app-rdo.js + visual-rdo.js."""
import pathlib, re
aqui = pathlib.Path(__file__).resolve().parent
ler = lambda nome: (aqui / nome).read_text(encoding='utf-8')
app = ler('app-rdo.js')
versao = re.search(r"const VERSAO_RDO = '([\d.]+)'", app).group(1)
base = ler('base-kz.html').replace('<title>Controle de Execução em Campo</title>', '<title>RDO — Relatório Diário de Obra</title>', 1)
assert '</style>\n</head>' in base
base = base.replace('</style>\n</head>', '\n' + ler('rdo.css') + '\n</style>\n</head>', 1)
marcador = '/* =============================================================================\n   10. TELA DE ENTRADA'
assert marcador in app
app = app.replace(marcador, ler('visual-rdo.js').rstrip('\n') + '\n\n\n' + marcador, 1)
final = base.rstrip('\n') + '\n\n' + app.rstrip('\n') + '\n\n})();\n</script>\n</body>\n</html>\n'
destino = aqui.parent / f'RDO v{versao}.html'
destino.write_text(final, encoding='utf-8', newline='\n')
(aqui.parent / 'index.html').write_text(final, encoding='utf-8', newline='\n')
print('gerado:', destino.name, len(final) // 1024, 'KB')

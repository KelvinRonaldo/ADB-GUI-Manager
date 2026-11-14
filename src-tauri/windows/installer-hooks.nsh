; Visual do instalador do ADB GUI Manager (incluído pelo Tauri antes das páginas).
; Imagens geradas por scripts/installer-images.sh; textos em lang/*.nsh.

; Ícone do cabeçalho à direita, títulos na cor de texto do tema original.
!define MUI_HEADERIMAGE_RIGHT
!define MUI_TEXTCOLOR "1F2329"

; Boas-vindas e conclusão.
!define MUI_WELCOMEPAGE_TITLE "$(adbWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(adbWelcomeText)"
!define MUI_FINISHPAGE_TITLE "$(adbFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(adbFinishText)"
!define MUI_FINISHPAGE_RUN_TEXT "$(adbRunNow)"
; Atalho na Área de Trabalho fica opcional (desmarcado).
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

; Texto do topo da tela Pasta e da confirmação do desinstalador (os padrões do NSIS em pt-BR
; cortam em 125% e usam "pra").
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(adbDirTop)"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "$(adbUnTop)"

; Depois de instalar, pede ao Explorer para recarregar os ícones: sem isso a barra de tarefas
; continua com o ícone antigo em cache para o mesmo caminho do .exe (visto ao atualizar da 0.3.x).
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

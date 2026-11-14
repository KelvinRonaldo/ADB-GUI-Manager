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

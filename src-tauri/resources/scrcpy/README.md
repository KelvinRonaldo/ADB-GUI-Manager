# scrcpy-server (embutido)

`scrcpy-server-v5.0.1` é o servidor oficial do [scrcpy](https://github.com/Genymobile/scrcpy)
(Genymobile, licença Apache 2.0, texto em `LICENSE`), baixado sem alteração da Release v5.0.1:

- https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-server-v5.0.1
- SHA-256 `764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536` (o mesmo da Release)

O ADB GUI Manager envia este arquivo para `/data/local/tmp/adbgui-scrcpy-server.jar` na hora de
espelhar e roda pelo `app_process` (nada é instalado no aparelho). O vídeo H.264 é decodificado na
própria janela do app (WebCodecs) e os toques e teclas voltam pelo socket de controle do scrcpy.

Para trocar de versão: baixe o servidor da nova Release, confira o SHA-256, troque o arquivo, ajuste
`SCRCPY_VERSION` em `src/mirror.rs` (o servidor exige a versão exata) e revise o protocolo
(`doc/develop.md` do scrcpy): ele muda entre versões.

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $workspace
uv venv --python 3.11 .tmp/separator-venv --allow-existing
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar Python 3.11 con uv.' }
uv pip install --python .tmp/separator-venv/Scripts/python.exe torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar PyTorch CPU.' }
uv pip install --python .tmp/separator-venv/Scripts/python.exe -r services/separator/local-requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar los modelos y el análisis musical.' }
Write-Output 'Entorno listo. Inicia AudioScore con npm run local.'

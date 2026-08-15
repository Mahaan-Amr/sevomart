$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'serve-seller-prototype.mjs')

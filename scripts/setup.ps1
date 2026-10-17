#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

git config core.hooksPath .githooks
Write-Host "Git hooks successfully activated (core.hooksPath = .githooks)"

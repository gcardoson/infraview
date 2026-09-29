# InfraView - painel de controle do servidor local (Windows).
#
# Abre uma janela para atualizar o codigo a partir do GitHub e iniciar, parar e
# reiniciar o servidor Docker que roda dentro do Ubuntu (WSL). Toda a logica fica
# em tools/infraview.sh; esta janela so chama o script e mostra o resultado.
#
# Para abrir: duplo clique em tools\InfraView.bat (ou no atalho da area de trabalho,
# criado na primeira execucao). Ao fechar a janela, o painel continua na bandeja do
# sistema, perto do relogio; o menu do botao direito tem os mesmos comandos.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = 'Stop'

# Esconde a janela de console do PowerShell, caso ela tenha aparecido.
Add-Type -Namespace InfraView -Name Native -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@
$consoleWindow = [InfraView.Native]::GetConsoleWindow()
if ($consoleWindow -ne [IntPtr]::Zero) { [void][InfraView.Native]::ShowWindow($consoleWindow, 0) }

# Uma unica instancia: se o painel ja estiver aberto, pede para ele aparecer e sai.
$createdNew = $false
$Mutex = New-Object System.Threading.Mutex($true, 'Local\InfraViewPainel', [ref]$createdNew)
$ShowSignal = New-Object System.Threading.EventWaitHandle($false, 'AutoReset', 'Local\InfraViewPainelMostrar')
if (-not $createdNew) {
    [void]$ShowSignal.Set()
    exit 0
}

$RepoWin = Split-Path -Parent $PSScriptRoot
$ConfigDir = Join-Path $env:APPDATA 'InfraView'
$ConfigFile = Join-Path $ConfigDir 'painel.json'
$TempDir = Join-Path $env:TEMP 'InfraView'
$AutoLabel = 'Automático (versão mais recente)'
New-Item -ItemType Directory -Force -Path $ConfigDir, $TempDir | Out-Null

# ---------------------------------------------------------------- configuracao

$Config = @{ branch = 'auto'; autoUpdate = $true }
if (Test-Path $ConfigFile) {
    try {
        $saved = Get-Content $ConfigFile -Raw | ConvertFrom-Json
        if ($saved.branch) { $Config.branch = [string]$saved.branch }
        if ($null -ne $saved.autoUpdate) { $Config.autoUpdate = [bool]$saved.autoUpdate }
    } catch { }
}

function Save-Config {
    $Config | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
}

# ------------------------------------------------------- caminho dentro do WSL

$RepoWsl = $null
try {
    $RepoWsl = (& wsl.exe wslpath -a ($RepoWin -replace '\\', '/') 2>$null | Select-Object -First 1)
    if ($RepoWsl) { $RepoWsl = $RepoWsl.Trim() }
} catch { }
if (-not $RepoWsl) {
    [System.Windows.Forms.MessageBox]::Show(
        "Não consegui acessar o Ubuntu (WSL).`n`nConfira se o Ubuntu está instalado: abra o Prompt e digite 'wsl'.",
        'InfraView', 'OK', 'Error') | Out-Null
    exit 1
}
$ScriptWsl = "$RepoWsl/tools/infraview.sh"

# ------------------------------------------------------------- atalho no desktop

# O atalho abre o lancador .vbs, que inicia o PowerShell sem janela de console.
$Launcher = Join-Path $PSScriptRoot 'InfraView.vbs'
$Wscript = "$env:SystemRoot\System32\wscript.exe"
$Shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'InfraView.lnk'
try {
    $shell = New-Object -ComObject WScript.Shell
    $existing = if (Test-Path $Shortcut) { $shell.CreateShortcut($Shortcut) } else { $null }
    if (-not $existing -or $existing.TargetPath -ne $Wscript) {
        $lnk = $shell.CreateShortcut($Shortcut)
        $lnk.TargetPath = $Wscript
        $lnk.Arguments = "`"$Launcher`""
        $lnk.WorkingDirectory = $RepoWin
        $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,18"
        $lnk.Description = 'Painel do servidor local InfraView'
        $lnk.Save()
    }
} catch { }

# Se uma atualizacao trouxer uma versao nova deste painel, ele se reabre sozinho.
$PanelHash = (Get-FileHash -Path $PSCommandPath -Algorithm SHA256).Hash

# ------------------------------------------------ processos em segundo plano
#
# Cada comando roda no WSL como root (sem pedir senha) e grava a saida num arquivo
# temporario, que a janela le aos poucos. Assim a janela nunca congela.

function Start-WslTask([string[]]$Arguments, [string]$Name) {
    $out = Join-Path $TempDir "$Name.log"
    [System.IO.File]::WriteAllBytes($out, [byte[]]@())
    $argText = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $inner = "wsl.exe -u root -- bash `"$ScriptWsl`" $argText > `"$out`" 2>&1"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "$env:SystemRoot\System32\cmd.exe"
    $psi.Arguments = '/d /s /c "' + $inner + '"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($psi)
    return @{ Process = $process; File = $out; Position = 0; Pending = New-Object System.Collections.Generic.List[byte] }
}

# Devolve as linhas novas (completas) que o processo escreveu desde a ultima leitura.
function Read-NewLines($Task, [switch]$Flush) {
    $lines = @()
    if (-not (Test-Path $Task.File)) { return $lines }
    try {
        $stream = [System.IO.File]::Open($Task.File, 'Open', 'Read', 'ReadWrite')
        try {
            $stream.Seek($Task.Position, 'Begin') | Out-Null
            $buffer = New-Object byte[] 65536
            while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                for ($i = 0; $i -lt $read; $i++) { $Task.Pending.Add($buffer[$i]) }
                $Task.Position += $read
            }
        } finally { $stream.Dispose() }
    } catch { return $lines }

    $bytes = $Task.Pending.ToArray()
    $cut = [Array]::LastIndexOf($bytes, [byte]10)
    if ($Flush) { $cut = $bytes.Length - 1 }
    if ($cut -ge 0) {
        $text = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $cut + 1)
        $Task.Pending.RemoveRange(0, $cut + 1)
        $lines = $text -split "`r?`n" | Where-Object { $_ -ne '' }
    }
    return $lines
}

# O servidor Docker vive no Ubuntu. Um processo "sleep" escondido impede que o WSL
# desligue o Ubuntu quando nenhuma janela esta aberta.
function Get-KeepAlive {
    Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*infraview-keepalive*' }
}

function Start-KeepAlive {
    if (-not (Get-KeepAlive)) {
        Start-Process -FilePath 'wsl.exe' -WindowStyle Hidden `
            -ArgumentList '-u', 'root', '--', 'bash', '-c', '"exec -a infraview-keepalive sleep infinity"'
    }
}

function Stop-KeepAlive {
    Get-KeepAlive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# ------------------------------------------------------------------- janela

$Dark = [System.Drawing.Color]::FromArgb(18, 23, 26)
$Panel = [System.Drawing.Color]::FromArgb(26, 32, 36)
$Text = [System.Drawing.Color]::FromArgb(215, 222, 226)
$Muted = [System.Drawing.Color]::FromArgb(130, 142, 150)
$Green = [System.Drawing.Color]::FromArgb(46, 230, 160)
$Amber = [System.Drawing.Color]::FromArgb(242, 184, 75)
$Red = [System.Drawing.Color]::FromArgb(255, 92, 92)
$Gray = [System.Drawing.Color]::FromArgb(83, 98, 107)

function New-DotIcon([System.Drawing.Color]$Color) {
    $bitmap = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $Dark), 1, 1, 30, 30)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $Color), 7, 7, 18, 18)
    $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$Icons = @{
    running = New-DotIcon $Green
    busy    = New-DotIcon $Amber
    problem = New-DotIcon $Red
    stopped = New-DotIcon $Gray
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'InfraView · Servidor local'
$form.Size = New-Object System.Drawing.Size(860, 640)
$form.MinimumSize = New-Object System.Drawing.Size(720, 520)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $Dark
$form.ForeColor = $Text
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$form.Icon = $Icons.stopped

$title = New-Object System.Windows.Forms.Label
$title.Text = 'INFRAVIEW'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18)
$title.ForeColor = $Text
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 14)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Servidor local  ·  inventário e monitoramento de infraestrutura'
$subtitle.ForeColor = $Muted
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(23, 52)
$form.Controls.Add($subtitle)

$statusDot = New-Object System.Windows.Forms.Label
$statusDot.Text = [char]0x25CF
$statusDot.Font = New-Object System.Drawing.Font('Segoe UI', 22)
$statusDot.ForeColor = $Gray
$statusDot.AutoSize = $true
$statusDot.Location = New-Object System.Drawing.Point(18, 82)
$form.Controls.Add($statusDot)

$statusText = New-Object System.Windows.Forms.Label
$statusText.Text = 'Verificando...'
$statusText.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 13)
$statusText.AutoSize = $true
$statusText.Location = New-Object System.Drawing.Point(52, 90)
$form.Controls.Add($statusText)

$detailText = New-Object System.Windows.Forms.Label
$detailText.ForeColor = $Muted
$detailText.AutoSize = $false
$detailText.Size = New-Object System.Drawing.Size(800, 40)
$detailText.Anchor = 'Top, Left, Right'
$detailText.Location = New-Object System.Drawing.Point(54, 118)
$form.Controls.Add($detailText)

function New-Button([string]$Label, [int]$X, [System.Drawing.Color]$Accent) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $Label
    $b.Size = New-Object System.Drawing.Size(128, 36)
    $b.Location = New-Object System.Drawing.Point($X, 166)
    $b.FlatStyle = 'Flat'
    $b.FlatAppearance.BorderColor = $Accent
    $b.BackColor = $Panel
    $b.ForeColor = $Accent
    $b.Cursor = 'Hand'
    $form.Controls.Add($b)
    return $b
}

$btnStart = New-Button 'Iniciar' 20 $Green
$btnStop = New-Button 'Parar' 156 $Red
$btnRestart = New-Button 'Reiniciar' 292 $Amber
$btnUpdate = New-Button 'Atualizar agora' 428 $Text
$btnOpen = New-Button 'Abrir no navegador' 564 $Green
$btnOpen.Size = New-Object System.Drawing.Size(150, 36)

$branchLabel = New-Object System.Windows.Forms.Label
$branchLabel.Text = 'Versão do código:'
$branchLabel.ForeColor = $Muted
$branchLabel.AutoSize = $true
$branchLabel.Location = New-Object System.Drawing.Point(20, 222)
$form.Controls.Add($branchLabel)

$branchBox = New-Object System.Windows.Forms.ComboBox
$branchBox.DropDownStyle = 'DropDownList'
$branchBox.Location = New-Object System.Drawing.Point(140, 218)
$branchBox.Size = New-Object System.Drawing.Size(320, 26)
$branchBox.BackColor = $Panel
$branchBox.ForeColor = $Text
$branchBox.FlatStyle = 'Flat'
[void]$branchBox.Items.Add($AutoLabel)
if ($Config.branch -ne 'auto') { [void]$branchBox.Items.Add($Config.branch) }
$branchBox.SelectedIndex = $(if ($Config.branch -eq 'auto') { 0 } else { 1 })
$form.Controls.Add($branchBox)

$autoBox = New-Object System.Windows.Forms.CheckBox
$autoBox.Text = 'Atualizar automaticamente (a cada minuto)'
$autoBox.Checked = $Config.autoUpdate
$autoBox.AutoSize = $true
$autoBox.ForeColor = $Text
$autoBox.Location = New-Object System.Drawing.Point(480, 220)
$form.Controls.Add($autoBox)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.WordWrap = $true
$log.BackColor = [System.Drawing.Color]::FromArgb(8, 10, 11)
$log.ForeColor = [System.Drawing.Color]::FromArgb(160, 200, 185)
$log.BorderStyle = 'FixedSingle'
$log.Font = New-Object System.Drawing.Font('Consolas', 9)
$log.Location = New-Object System.Drawing.Point(20, 258)
$log.Size = New-Object System.Drawing.Size(804, 300)
$log.Anchor = 'Top, Bottom, Left, Right'
$form.Controls.Add($log)

$footer = New-Object System.Windows.Forms.Label
$footer.Text = 'Fechar esta janela mantém o painel na bandeja do sistema. Para sair, use Desligar no menu da bandeja.'
$footer.ForeColor = $Muted
$footer.AutoSize = $true
$footer.Anchor = 'Bottom, Left'
$footer.Location = New-Object System.Drawing.Point(20, 570)
$form.Controls.Add($footer)

# ------------------------------------------------------------ bandeja do sistema

$menu = New-Object System.Windows.Forms.ContextMenuStrip
function New-MenuItem([string]$Label) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem $Label
    [void]$menu.Items.Add($item)
    return $item
}
$miOpen = New-MenuItem 'Abrir painel'
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$miBrowser = New-MenuItem 'Abrir no navegador'
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miStart = New-MenuItem 'Iniciar'
$miStop = New-MenuItem 'Parar'
$miRestart = New-MenuItem 'Reiniciar...'
$miUpdate = New-MenuItem 'Atualizar'
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miShutdown = New-MenuItem 'Desligar...'

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $Icons.stopped
$tray.Text = 'InfraView'
$tray.ContextMenuStrip = $menu
$tray.Visible = $true

function Show-Panel {
    $form.Show()
    if ($form.WindowState -eq 'Minimized') { $form.WindowState = 'Normal' }
    $form.Activate()
}

function Show-Balloon([string]$Message, [string]$Kind = 'Info') {
    if (-not $form.Visible) { $tray.ShowBalloonTip(4000, 'InfraView', $Message, $Kind) }
}

# Pergunta antes de comandos que derrubam o servidor. "Nao" e o botao padrao,
# para um Enter ou clique apressado nao confirmar.
function Confirm-Action([string]$Message) {
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    try {
        $answer = [System.Windows.Forms.MessageBox]::Show($owner, $Message, 'InfraView',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question,
            [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
    } finally { $owner.Dispose() }
    return $answer -eq [System.Windows.Forms.DialogResult]::Yes
}

function Write-Log([string]$Line) {
    $log.AppendText(("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Line) + [Environment]::NewLine)
}

function Get-SelectedBranch {
    if ($branchBox.SelectedIndex -le 0) { return 'auto' }
    return [string]$branchBox.SelectedItem
}

# ------------------------------------------------------------------- estado

$script:Busy = $null        # tarefa visivel em andamento (iniciar, parar, ...)
$script:StatusTask = $null  # consulta de status silenciosa
$script:CheckTask = $null   # verificacao silenciosa de atualizacao
$script:BranchTask = $null  # lista de versoes disponiveis
$script:State = @{}
$script:LastCheck = [DateTime]::MinValue

function Update-Buttons {
    $idle = -not $script:Busy
    $running = $script:State.server -eq 'running' -or $script:State.server -eq 'partial'
    $btnStart.Enabled = $idle -and -not $running
    $btnStop.Enabled = $idle -and $running
    $btnRestart.Enabled = $idle -and $running
    $btnUpdate.Enabled = $idle
    $branchBox.Enabled = $idle
    $btnOpen.Enabled = $running
    $miStart.Enabled = $btnStart.Enabled
    $miStop.Enabled = $btnStop.Enabled
    $miRestart.Enabled = $btnRestart.Enabled
    $miUpdate.Enabled = $btnUpdate.Enabled
    $miBrowser.Enabled = $running
}

function Show-Status {
    $s = $script:State
    $icon = $null
    if ($script:Busy) {
        $statusDot.ForeColor = $Amber
        $statusText.Text = $script:Busy.Label
        $icon = $Icons.busy
    } elseif ($s.server -eq 'running') {
        $statusDot.ForeColor = $Green
        $statusText.Text = 'Servidor rodando'
        $icon = $Icons.running
    } elseif ($s.server -eq 'partial') {
        $statusDot.ForeColor = $Red
        $statusText.Text = 'Servidor com problema (algum container parado)'
        $icon = $Icons.problem
    } elseif ($s.server) {
        $statusDot.ForeColor = $Gray
        $statusText.Text = 'Servidor parado'
        $icon = $Icons.stopped
    }
    if ($icon) {
        $tray.Icon = $icon
        $form.Icon = $icon
        $tip = "InfraView: $($statusText.Text)"
        $tray.Text = $tip.Substring(0, [Math]::Min(63, $tip.Length))
    }
    $parts = @()
    if ($s.version) { $parts += "Versão: $($s.branch) @ $($s.version)" }
    if ($s.services) { $parts += "Containers: $($s.services)" }
    if ($s.server -eq 'running' -and $s.url) { $parts += "Endereço: $($s.url)" }
    $detailText.Text = $parts -join "`n"
    Update-Buttons
}

function Start-Action([string]$Label, [string[]]$Arguments, [scriptblock]$Before) {
    if ($script:Busy) { return }
    if ($Before) { & $Before }
    Write-Log "== $Label"
    $task = Start-WslTask $Arguments 'acao'
    $task.Label = $Label
    $script:Busy = $task
    Show-Status
}

function Request-Status {
    if (-not $script:StatusTask) { $script:StatusTask = Start-WslTask @('status') 'status' }
}

$script:Exiting = $false      # true quando o usuario escolheu Desligar
$script:ExitAfterTask = $false

function Invoke-Start { Start-Action 'Iniciando o servidor...' @('start') { Start-KeepAlive } }
function Invoke-Stop { Start-Action 'Parando o servidor...' @('stop') }
function Invoke-Update { Start-Action 'Atualizando o código...' @('update', (Get-SelectedBranch)) }
function Invoke-Browser { Start-Process $(if ($script:State.url) { $script:State.url } else { 'http://localhost:8080' }) }

function Invoke-Restart {
    if ($script:Busy) { return }
    if (Confirm-Action "Reiniciar o servidor InfraView?`n`nEle fica fora do ar por alguns instantes.") {
        Start-Action 'Reiniciando o servidor...' @('restart') { Start-KeepAlive }
    }
}

# Desligar: para o servidor (se estiver rodando) e fecha o painel.
function Invoke-Shutdown {
    if (-not (Confirm-Action "Desligar o servidor InfraView e fechar o painel?")) { return }
    $running = $script:State.server -eq 'running' -or $script:State.server -eq 'partial'
    if ($running -and -not $script:Busy) {
        $script:ExitAfterTask = $true
        Start-Action 'Desligando o servidor...' @('stop')
    } elseif ($script:Busy) {
        $script:ExitAfterTask = $true
        Write-Log 'O painel fecha assim que a tarefa atual terminar.'
    } else {
        Exit-Panel
    }
}

# Fecha o painel de verdade. Com -KeepServer (reabertura apos atualizar o painel),
# mantem o processo que segura o Ubuntu ligado, para o servidor nao cair.
function Exit-Panel([switch]$KeepServer) {
    $script:Exiting = $true
    if (-not $KeepServer) { Stop-KeepAlive }
    $form.Close()
}

$btnStart.Add_Click({ Invoke-Start })
$btnStop.Add_Click({ Invoke-Stop })
$btnRestart.Add_Click({ Invoke-Restart })
$btnUpdate.Add_Click({ Invoke-Update })
$btnOpen.Add_Click({ Invoke-Browser })
$miOpen.Add_Click({ Show-Panel })
$miBrowser.Add_Click({ Invoke-Browser })
$miStart.Add_Click({ Invoke-Start })
$miStop.Add_Click({ Invoke-Stop })
$miRestart.Add_Click({ Invoke-Restart })
$miUpdate.Add_Click({ Invoke-Update })
$miShutdown.Add_Click({ Invoke-Shutdown })
$tray.Add_MouseDoubleClick({ Show-Panel })
$branchBox.Add_SelectionChangeCommitted({ $Config.branch = Get-SelectedBranch; Save-Config })
$autoBox.Add_CheckedChanged({ $Config.autoUpdate = $autoBox.Checked; Save-Config })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$script:Tick = 0
$timer.Add_Tick({
    $script:Tick++

    # Saida da tarefa visivel
    if ($script:Busy) {
        foreach ($line in Read-NewLines $script:Busy) { Write-Log $line }
        if ($script:Busy.Process.HasExited) {
            foreach ($line in Read-NewLines $script:Busy -Flush) { Write-Log $line }
            $code = $script:Busy.Process.ExitCode
            $label = $script:Busy.Label
            if ($code -ne 0) {
                Write-Log "!! Terminou com erro (código $code). Veja as mensagens acima."
                Show-Balloon "$label falhou. Abra o painel para ver o log." 'Error'
            } else {
                Write-Log '== Concluído.'
                if ($label -like 'Atualizando*') { Show-Balloon 'Servidor atualizado com a versão mais recente.' }
            }
            if ($label -like 'Parando*' -or $label -like 'Desligando*') { Stop-KeepAlive }
            $script:Busy = $null
            if ($script:ExitAfterTask) {
                Exit-Panel
                return
            }
            Request-Status
            Show-Status

            # Painel atualizado pelo git: reabre com a versao nova.
            $hash = (Get-FileHash -Path $PSCommandPath -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
            if ($hash -and $hash -ne $PanelHash) {
                Write-Log 'Nova versão do painel. Reabrindo...'
                $script:Relaunch = $true
                Exit-Panel -KeepServer
                return
            }
        }
    }

    # Outra instancia pediu para mostrar a janela
    if ($ShowSignal.WaitOne(0)) { Show-Panel }

    # Status (a cada ~5 s)
    if ($script:StatusTask -and $script:StatusTask.Process.HasExited) {
        $state = @{}
        foreach ($line in Read-NewLines $script:StatusTask -Flush) {
            $k, $v = $line -split '=', 2
            if ($v -ne $null) { $state[$k.Trim()] = $v.Trim() }
        }
        if ($state.Count) { $script:State = $state }
        $script:StatusTask = $null
        if ($script:State.server -eq 'running') { Start-KeepAlive }
        Show-Status
    } elseif (-not $script:StatusTask -and ($script:Tick % 12) -eq 0) {
        Request-Status
    }

    # Lista de versoes
    if ($script:BranchTask -and $script:BranchTask.Process.HasExited) {
        $current = [string]$branchBox.SelectedItem
        $names = Read-NewLines $script:BranchTask -Flush | Where-Object { $_ -notmatch '^(>>|ERRO)' }
        $branchBox.BeginUpdate()
        $branchBox.Items.Clear()
        [void]$branchBox.Items.Add($AutoLabel)
        foreach ($n in $names) { [void]$branchBox.Items.Add($n.Trim()) }
        $index = $branchBox.Items.IndexOf($current)
        $branchBox.SelectedIndex = $(if ($index -ge 0) { $index } else { 0 })
        $branchBox.EndUpdate()
        $script:BranchTask = $null
    }

    # Atualizacao automatica: verifica em silencio e so atualiza se houver novidade
    if ($script:CheckTask -and $script:CheckTask.Process.HasExited) {
        $code = $script:CheckTask.Process.ExitCode
        $script:CheckTask = $null
        if ($code -eq 10 -and -not $script:Busy) {
            Write-Log 'Nova versão encontrada no GitHub.'
            Start-Action 'Atualizando o código...' @('update', (Get-SelectedBranch))
        }
    } elseif ($autoBox.Checked -and -not $script:Busy -and -not $script:CheckTask -and
        ((Get-Date) - $script:LastCheck).TotalSeconds -ge 60) {
        $script:LastCheck = Get-Date
        $script:CheckTask = Start-WslTask @('check', (Get-SelectedBranch)) 'check'
    }
})

$form.Add_Shown({
    Write-Log "Pasta do projeto: $RepoWin"
    Request-Status
    $script:BranchTask = Start-WslTask @('branches') 'branches'
    $timer.Start()
})

# O X da janela so esconde o painel; ele continua na bandeja.
$script:TrayHintShown = $false
$form.Add_FormClosing({
    param($sender, $e)
    if (-not $script:Exiting -and $e.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
        $e.Cancel = $true
        $form.Hide()
        if (-not $script:TrayHintShown) {
            $script:TrayHintShown = $true
            $tray.ShowBalloonTip(4000, 'InfraView',
                'O painel continua aqui na bandeja. Clique com o botão direito para os comandos.', 'Info')
        }
        return
    }
    $timer.Stop()
    $tray.Visible = $false
})

$script:Relaunch = $false
$ErrorActionPreference = 'Continue'
[System.Windows.Forms.Application]::Run($form)

$tray.Dispose()
$Mutex.ReleaseMutex()
$Mutex.Dispose()
if ($script:Relaunch) { Start-Process -FilePath $Wscript -ArgumentList "`"$Launcher`"" }

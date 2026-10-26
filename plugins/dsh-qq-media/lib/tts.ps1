param(
  [Parameter(Mandatory=$true)][string]$TextFile,
  [Parameter(Mandatory=$true)][string]$OutputFile,
  [string]$Voice = "Microsoft Huihui",
  [int]$Rate = 0
)
Add-Type -AssemblyName System.Speech
$text = Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($text)) { throw "empty text" }
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled })
$chosen = $voices | Where-Object { $_.VoiceInfo.Name -eq $Voice -or $_.VoiceInfo.Name -like "*$Voice*" } | Select-Object -First 1
if (-not $chosen) { $chosen = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like "zh-CN*" } | Select-Object -First 1 }
if ($chosen) { $synth.SelectVoice($chosen.VoiceInfo.Name) }
$synth.Rate = $Rate
$synth.Volume = 100
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($OutputFile, $fmt)
$synth.Speak($text)
$synth.Dispose()
Write-Output $chosen.VoiceInfo.Name
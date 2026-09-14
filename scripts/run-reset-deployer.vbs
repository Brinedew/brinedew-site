Option Explicit

' Task Scheduler starts the reset dispatcher every five minutes during its
' bounded UTC-reset window.  Launching pwsh directly can flash a console before
' -WindowStyle Hidden is processed, stealing focus from the interactive desktop.
' WScript owns the child launch and waits for its real exit code, so Task
' Scheduler retains the same execution/deadline semantics without a visible
' terminal window.
Dim shell, fileSystem, scriptDirectory, powerShellPath, runnerPath, commandLine, exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = "C:\Program Files\PowerShell\7\pwsh.exe"
runnerPath = fileSystem.BuildPath(scriptDirectory, "run-reset-deployer.ps1")

If Not fileSystem.FileExists(powerShellPath) Then
    WScript.Quit 2
End If
If Not fileSystem.FileExists(runnerPath) Then
    WScript.Quit 3
End If

commandLine = """" & powerShellPath & """ -NoProfile -NonInteractive -File """" & runnerPath & """"
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

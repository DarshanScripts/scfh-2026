param(
  [Parameter(Mandatory)][string] $Title,
  [Parameter(Mandatory)][string] $ResultFile,
    [string] $InitialText = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.ClientSize = New-Object System.Drawing.Size(340, 150)
$form.StartPosition = 'CenterScreen'
$form.Add_Shown({ $form.Activate() })

$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.AccessibleName = 'Desktop check input'
$inputBox.Text = $InitialText
$inputBox.Location = New-Object System.Drawing.Point(20, 20)
$inputBox.Width = 280
$form.Controls.Add($inputBox)

$button = New-Object System.Windows.Forms.Button
$button.Text = 'Confirm desktop check'
$button.Location = New-Object System.Drawing.Point(20, 60)
$button.Width = 160
$status = New-Object System.Windows.Forms.Label
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(20, 100)
$status.Text = 'Waiting for confirmation'
$form.Controls.Add($status)

$button.Add_Click({
  [System.IO.File]::WriteAllText($ResultFile, $inputBox.Text)
  $status.Text = 'Desktop check confirmed'
  $button.Enabled = $false
})
$form.Controls.Add($button)

[System.Windows.Forms.Application]::Run($form)

// Apply saved dark mode preference on page load
window.addEventListener('DOMContentLoaded', () => {
  const toggleSwitch = document.getElementById('dark-mode-toggle');
  const darkMode = localStorage.getItem('dark-mode');

  if (darkMode === 'enabled') {
    document.body.classList.add('dark-mode');
    if (toggleSwitch) toggleSwitch.checked = true;
  }
});

// Toggle dark mode on checkbox change
function checkChange() {
  const toggleSwitch = document.getElementById('dark-mode-toggle');
  const isChecked = toggleSwitch.checked;

  if (isChecked) {
    document.body.classList.add('dark-mode');
    localStorage.setItem('dark-mode', 'enabled');
  } else {
    document.body.classList.remove('dark-mode');
    localStorage.setItem('dark-mode', 'disabled');
  }

  console.log("Dark mode toggled:", isChecked);
}

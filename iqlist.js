function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
  }

// Add an event listener to the toggle switch
function checkChange() {
    // Get the toggle switch element and the body
    const toggleSwitch = document.getElementById('dark-mode-toggle');
    const body = document.body;

    // Load the user's preference from localStorage
    if (localStorage.getItem('dark-mode') === 'enabled') {
        body.classList.add('dark-mode');
        toggleSwitch.checked = true;
    }
    // Get the toggle switch element and the body

    if (toggleSwitch.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('dark-mode', 'disabled');

    } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('dark-mode', 'enabled');
    }
    console.log("Hitting here")
}

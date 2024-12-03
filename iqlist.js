
// Get the toggle switch element and the body
const toggleSwitch = document.getElementById('dark-mode-toggle');
const body = document.body;

// Load the user's preference from localStorage
if (localStorage.getItem('dark-mode') === 'enabled') {
    body.classList.add('dark-mode');
    toggleSwitch.checked = true;
}

// Add an event listener to the toggle switch
toggleSwitch.addEventListener('change', function() {
    if (this.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('dark-mode', 'enabled');
    } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('dark-mode', 'disabled');
    }
});



// Typing animation
document.addEventListener('DOMContentLoaded', function () {
    typeWriter();
});


  var i = 0;
  var j = 0;
  var title = 'AI Similarity';
  var title1 = 'Interview Questions List';
  var speed = 100;

    function typeWriter() {
      if (i < title.length) {
        document.getElementById("title").innerHTML += title.charAt(i);
        i++;
      }
      if (j < title1.length) {
        document.getElementById("title1").innerHTML += title1.charAt(j);
        j++;
        
      }
      setTimeout(typeWriter, speed);
    }
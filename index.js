window.onload = function () {
    console.log("Form Loaded")
};

document.addEventListener('DOMContentLoaded', function () {
    const switchInput = document.querySelector('.switch input');
    switchInput.addEventListener('change', function () {
        document.body.classList.toggle('dark-mode', this.checked);
    });

    typeWriter();
});

function onContributorListJoinClick() {
    //const button = document.getElementById('myButton');
    var link = 'https://forms.gle/wjcHvYAdYxPHodTN8'
    window.location.href = link
}
function onInterviewQuestionsListClick() {
    //const button = document.getElementById('myButton');
    var link = '/iqlist.html'
    window.location.href = link
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

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());

gtag('config', 'G-92KXYXDDWD');
var tableData = "table-data-"
var form = "form"
var net = "net"
var view = "view"
var ui = "ui"


//Animation
// Typing animation
//   var i = 0;
//   var title = 'Welcome to AI Similarity';
//   var speed = 200;

//     function typeWriter() {
//       if (i < title.length) {
//         document.getElementById("title").innerHTML += title.charAt(i);
//         i++;
//       }
//       setTimeout(typeWriter, speed);
//     }



function onShareFeedbackClick() {
    var link = 'https://forms.gle/qMAD5hX2VPjahmLAA'
    window.location.href = link
}

function search() {
    console.log("Search was clicked");
    // Get the value from the search input
    var query = document.getElementById("search-query").value.toLowerCase();
    // Check if the search query is not empty
    if (query) {
        alter(tableData + form, query)
        alter(tableData + ui, query)
        alter(tableData + net, query)
        alter(tableData + view, query)
    } else {
        location.reload(true);
    }
}
function emptySearch() {
    location.reload(true);
}

function alter(id, query) {
    var table = document.getElementById(id);

    console.log(query);
    // Alternatively, you can display search results on the same page
    // For that, you would need to write logic to fetch and display the results
    // Get the table and rows
    let rows = table.getElementsByTagName('tbody')[0].getElementsByTagName('tr');

    // Loop through each row
    for (let i = 0; i < rows.length; i++) {
        let cells = rows[i].getElementsByTagName('td');
        let found = false;

        // Check each cell in the row
        for (let j = 0; j < cells.length; j++) {
            if (cells[j].textContent.toLowerCase().includes(query)) {
                found = true;
                break;
            }
        }

        // Show or hide the row based on whether a match was found
        if (found) {
            rows[i].style.display = '';
        } else {
            rows[i].style.display = 'none';
        }
    }
}

function toggleDrawer() {
  const drawer = document.getElementById('drawer');
  drawer.classList.toggle('hidden');
}

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
}


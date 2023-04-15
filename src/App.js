//import logo from './logo.svg';
import logo from './aisimilarity.gif';
import React, { Component } from 'react';
import './App.css';
function App() {
  return (
    <div className="App">
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-KK94CHFLLe+nY2dmCWGMq91rCGa5gtU4mk92HdvYe+M/SXH301p5ILy+dN9+nJOZ" crossorigin="anonymous"></link>
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
         Welcome to AI Similarity.com
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer">
          </a>


      </header>
      <div>
      <table class="table table-striped table-dark">
        <caption>UI Components</caption>
      <thead>
        <tr>
      <th scope="col">Component Name</th>
      <th scope="col">Android Native</th>
      <th scope="col">iOS Native</th>
      <th scope="col">React Native</th>
      <th scope="col">Xamarin</th>
      <th scope="col">Flutter</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Text Box</th>
      <td><a href="https://developer.android.com/reference/android/widget/EditText">EditText</a></td>
      <td><a href="https://developer.apple.com/documentation/uikit/uitextfield">UITextField</a></td>
      <td>@mdo</td>
      <td>@mdo</td>
      <td>@mdo</td>
    </tr>
    <tr>
      <th scope="row">Text Label</th>
      <td>Jacob</td>
      <td>Thornton</td>
      <td>@fat</td>
      <td>@fat</td>
      <td>@fat</td> 
    </tr>
    <tr>
      <th scope="row">Drop Down</th>
      <td>Spinner</td>
      <td>///</td>
      <td>///</td>
      <td>///</td>
      <td>///</td>
    </tr>
  </tbody>
</table>
      </div>
    </div>
  );
}

export default App;

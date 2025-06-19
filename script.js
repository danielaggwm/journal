import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
  } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
  
  document.addEventListener('DOMContentLoaded', () => {
    const auth = window.firebaseApp?.auth;
  
    if (!auth) {
      console.error("Firebase auth is not initialized yet.");
      return;
    }
  
    // Auth listeners
    document.getElementById('signup').addEventListener('click', () => {
      const email = document.getElementById('email').value;
      const pass = document.getElementById('password').value;
  
      createUserWithEmailAndPassword(auth, email, pass)
        .then(() => alert("Signup successful"))
        .catch(err => alert(err.message));
    });
  
    document.getElementById('login').addEventListener('click', () => {
      const email = document.getElementById('email').value;
      const pass = document.getElementById('password').value;
  
      signInWithEmailAndPassword(auth, email, pass)
        // .then(() => alert("Login successful"))
        .catch(err => alert(err.message));
    });
  
    document.getElementById('logout').addEventListener('click', () => {
      signOut(auth);
    });
  
    onAuthStateChanged(auth, user => {
        if (user) {
          document.getElementById('auth-modal').style.display = 'none';
          document.getElementById('logout-wrapper').style.display = 'block';
          document.getElementById('calendar').style.display = 'block';
        } else {
          document.getElementById('auth-modal').style.display = 'flex';
          document.getElementById('logout-wrapper').style.display = 'none';
          document.getElementById('calendar').style.display = 'none';
        }
    });
  
    // FullCalendar (no import)
    let calendar; // declare globally so we can reuse

    onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById('auth-modal').style.display = 'none';
        document.getElementById('logout-wrapper').style.display = 'block';
        document.getElementById('calendar').style.display = 'block';

        if (!calendar) {
        const calendarEl = document.getElementById('calendar');
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            dateClick: function (info) {
            const clickedDate = info.dateStr;
            alert(`You clicked on: ${clickedDate}`);
            }
        });

        calendar.render();
        } else {
        calendar.updateSize(); // re-calculate layout
        }

    } else {
        document.getElementById('auth-modal').style.display = 'flex';
        document.getElementById('logout-wrapper').style.display = 'none';
        document.getElementById('calendar').style.display = 'none';
    }
    }); 
  });
  
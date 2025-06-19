import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

// ADD THESE TWO ⬇️
import {
  doc, setDoc, getDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

let auth; // ✅ global declaration

// journal entry firebase logic
const db = window.firebaseApp.db;
const storage = window.firebaseApp.storage;

async function saveJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return alert("Not logged in");

  const mood = document.getElementById('mood-select').value;
  const description = document.getElementById('description').value;
  const imageFile = document.getElementById('image-upload').files[0];

  let imageUrl = "";

  if (imageFile) {
    const storageRef = ref(storage, `journalImages/${user.uid}_${date}`);
    await uploadBytes(storageRef, imageFile);
    imageUrl = await getDownloadURL(storageRef);
  }

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  await setDoc(entryRef, {
    userId: user.uid,
    date,
    mood,
    description,
    imageUrl,
    timestamp: new Date()
  });

  alert("Saved!");
}

async function loadJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return;

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  const docSnap = await getDoc(entryRef);

  const imgPreview = document.getElementById('image-preview');

  if (docSnap.exists()) {
    const data = docSnap.data();
    document.getElementById('mood-select').value = data.mood;
    document.getElementById('description').value = data.description;

    if (data.imageUrl) {
      imgPreview.src = data.imageUrl;
      imgPreview.style.display = 'block';
    } else {
      imgPreview.src = '';
      imgPreview.style.display = 'none';
    }

    document.getElementById('clear-entry').style.display = 'inline';
  } else {
    document.getElementById('mood-select').value = '';
    document.getElementById('description').value = '';
    imgPreview.src = '';
    imgPreview.style.display = 'none';
    document.getElementById('clear-entry').style.display = 'none';
  }
}


async function clearJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return;

  const entryId = `${user.uid}_${date}`;
  await deleteDoc(doc(db, "journalEntries", entryId));

  // Delete image
  const imgRef = ref(storage, `journalImages/${entryId}`);
  try {
    await deleteObject(imgRef);
  } catch (err) {
    console.log("No image to delete");
  }

  alert("Entry cleared.");
}

  


  document.addEventListener('DOMContentLoaded', () => {
     auth = window.firebaseApp?.auth;
  
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
              openJournalModal(info.dateStr);
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
  

// journal entry pop up 
let selectedDate = null;

function openJournalModal(dateStr) {
  selectedDate = dateStr;
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = new Date(dateStr).toLocaleDateString('en-US', options);
  document.getElementById('journal-date-label').textContent = formattedDate;
  document.getElementById('image-upload').value = '';
  document.getElementById('journal-modal').style.display = 'flex';
  loadJournalEntry(dateStr);
}



document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('journal-modal').style.display = 'none';
});

document.getElementById('save-entry').addEventListener('click', async () => {
  await saveJournalEntry(selectedDate);
  document.getElementById('journal-modal').style.display = 'none';
});

document.getElementById('clear-entry').addEventListener('click', async () => {
  await clearJournalEntry(selectedDate);
  document.getElementById('journal-modal').style.display = 'none';
});



document.getElementById('image-upload').addEventListener('change', (event) => {
  const file = event.target.files[0];
  const imgPreview = document.getElementById('image-preview');

  if (file) {
    imgPreview.src = URL.createObjectURL(file);
    imgPreview.style.display = 'block';
  } else {
    imgPreview.src = '';
    imgPreview.style.display = 'none';
  }
});

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

let auth; 
let calendar; 
let currentViewMode = 'mood';

// Reusable function to create and render the calendar views
function renderCalendar() {
  const calendarEl = document.getElementById('calendar');

  if (calendar) {
    calendar.destroy();
  }

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    dateClick: function (info) {
      openJournalModal(info.dateStr);
    },
    dayCellDidMount: async function (info) {
      const dateStr = info.date.toISOString().split('T')[0];
      const user = auth.currentUser;
      if (!user) return;

      const entryRef = doc(db, "journalEntries", `${user.uid}_${dateStr}`);
      const docSnap = await getDoc(entryRef);
      if (!docSnap.exists()) return;
      const data = docSnap.data();

      if (currentViewMode === 'image' && data.imageUrl) {
        info.el.style.backgroundImage = `url(${data.imageUrl})`;
        info.el.style.backgroundSize = 'cover';
        info.el.style.backgroundPosition = 'center';
      }

      if (currentViewMode === 'mood' && data.mood) {
        const colorMap = {
          good: 'green',
          sad: 'blue',
          angry: 'red',
          excited: 'orange'
        };

        const circle = document.createElement('div');
        circle.style.position = 'absolute';
        circle.style.bottom = '5px';
        circle.style.right = '5px';
        circle.style.width = '12px';
        circle.style.height = '12px';
        circle.style.borderRadius = '50%';
        circle.style.backgroundColor = colorMap[data.mood] || 'gray';

        info.el.style.position = 'relative';
        info.el.appendChild(circle);
      }
    }
  });

  calendar.render();
}

// journal entry firebase logic
const db = window.firebaseApp.db;
const storage = window.firebaseApp.storage;

async function saveJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return alert("Not logged in");

  const mood = document.getElementById('selected-mood').value;
  const description = document.getElementById('description').value;
  const imageFile = document.getElementById('image-upload').files[0];

  let imageUrl = "";

  if (imageFile) {
    try {
      // Compress the image
      const compressedFile = await imageCompression(imageFile, {
        maxSizeMB: 0.2, // Compress to ~200KB
        maxWidthOrHeight: 1000, // Optional resize
        useWebWorker: true,
      });

      const storageRef = ref(storage, `journalImages/${user.uid}_${date}`);
      await uploadBytes(storageRef, compressedFile);
      imageUrl = await getDownloadURL(storageRef);
    } catch (error) {
      console.error("Image compression/upload failed:", error);
      alert("Image upload failed.");
      return;
    }
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
}


async function loadJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return;

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  const docSnap = await getDoc(entryRef);

  const imgPreview = document.getElementById('image-preview');

  if (docSnap.exists()) {
    const data = docSnap.data();

    // Set mood visually and in hidden input
    moodButtons.forEach(btn => {
      if (btn.dataset.mood === data.mood) {
        btn.classList.add('selected');
        selectedMoodInput.value = data.mood;
      } else {
        btn.classList.remove('selected');
      }
    });

    document.getElementById('description').value = data.description;

    if (data.imageUrl) {
      imgPreview.src = data.imageUrl;
      imgPreview.style.display = 'block';
      document.getElementById('image-preview-wrapper').style.display = 'block';
      document.getElementById('upload-label').style.display = 'none';
    } else {
      imgPreview.src = '';
      imgPreview.style.display = 'none';
      document.getElementById('image-preview-wrapper').style.display = 'none';
      document.getElementById('upload-label').style.display = 'inline-block';
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
}

  
document.addEventListener('DOMContentLoaded', () => {
  auth = window.firebaseApp?.auth;
  if (!auth) return console.error("Firebase auth not initialized.");

  // Auth buttons
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
      .catch(err => alert(err.message));
  });

  document.getElementById('logout').addEventListener('click', () => {
    signOut(auth);
  });

  // SINGLE onAuthStateChanged
  onAuthStateChanged(auth, user => {
    if (user) {
      document.getElementById('auth-modal').style.display = 'none';
      document.getElementById('logout-wrapper').style.display = 'block';
      document.getElementById('calendar').style.display = 'block';
      renderCalendar(); // ⬅️ Only one calendar render
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

  // Format date nicely (e.g., June 19, 2025)
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  
  const [year, month, day] = dateStr.split("-");
  const localDate = new Date(Number(year), Number(month) - 1, Number(day));
  const formattedDate = localDate.toLocaleDateString('en-US', options);

  document.getElementById('journal-date-label').textContent = formattedDate;

  // Reset form fields
  document.getElementById('mood-select').value = '';
  document.getElementById('description').value = '';
  document.getElementById('image-upload').value = '';

  // Reset image preview UI
  document.getElementById('image-preview').src = '';
  document.getElementById('image-preview-wrapper').style.display = 'none';
  document.getElementById('upload-label').style.display = 'inline-block';

  // Show the modal
  document.getElementById('journal-modal').style.display = 'flex';

  
  moodButtons.forEach(btn => btn.classList.remove('selected'));
  selectedMoodInput.value = '';
  // Load saved data (if any)
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


// image upload and preview
const imageUploadInput = document.getElementById('image-upload');
const imagePreview = document.getElementById('image-preview');
const imagePreviewWrapper = document.getElementById('image-preview-wrapper');
const removeImageButton = document.getElementById('remove-image');
const uploadLabel = document.getElementById('upload-label');
const imageOverlay = document.getElementById('image-overlay');
const fullImage = document.getElementById('full-image');

imageUploadInput.addEventListener('change', () => {
  const file = imageUploadInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      imagePreview.src = e.target.result;
      imagePreviewWrapper.style.display = 'block';
      uploadLabel.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
});

removeImageButton.addEventListener('click', () => {
  imageUploadInput.value = '';
  imagePreview.src = '';
  imagePreviewWrapper.style.display = 'none';
  uploadLabel.style.display = 'inline-block';
});

imagePreview.addEventListener('click', () => {
  fullImage.src = imagePreview.src;
  imageOverlay.style.display = 'flex';
});

imageOverlay.addEventListener('click', () => {
  imageOverlay.style.display = 'none';
});

// mood selections
const moodButtons = document.querySelectorAll('.mood-button');
const selectedMoodInput = document.getElementById('selected-mood');

moodButtons.forEach(button => {
  button.addEventListener('click', () => {
    moodButtons.forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');
    selectedMoodInput.value = button.dataset.mood;
  });
});

document.getElementById('toggle-view').addEventListener('click', () => {
  currentViewMode = currentViewMode === 'mood' ? 'image' : 'mood';
  renderCalendar(); // re-render calendar with updated view mode
});

document.getElementById('save-entry').addEventListener('click', async () => {
  await saveJournalEntry(selectedDate);
  document.getElementById('journal-modal').style.display = 'none';
  renderCalendar(); // re-render to update UI
});

document.getElementById('clear-entry').addEventListener('click', async () => {
  await clearJournalEntry(selectedDate);
  document.getElementById('journal-modal').style.display = 'none';
  renderCalendar(); // re-render to remove the mood circle
});

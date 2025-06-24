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
let currentViewMode = 'image';

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

      // Image mode
      if (currentViewMode === 'image' && data.imageUrl) {
        info.el.style.backgroundImage = `url(${data.imageUrl})`;
        info.el.style.backgroundSize = 'cover';
        info.el.style.backgroundPosition = 'center';
      }

      // Mood mode
      if (currentViewMode === 'mood' && data.mood) {
        const colorMap = {
          good: 'green',
          sad: '#1e81b0',
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

      // Habit view mode with SVG icons
      if (['workout', 'read', 'called'].includes(currentViewMode)) {
        const value = data[currentViewMode];

        if (value === 'yes' || value === 'no') {
          const circle = document.createElement('div');
          circle.style.position = 'absolute';
          circle.style.bottom = '5px';
          circle.style.right = '5px';
          circle.style.width = '20px';
          circle.style.height = '20px';
          circle.style.borderRadius = '50%';
          circle.style.backgroundColor = value === 'yes' ? 'green' : '#B22222';
          circle.style.display = 'flex';
          circle.style.alignItems = 'center';
          circle.style.justifyContent = 'center';

          const img = document.createElement('img');
          img.src = value === 'yes' ? '/journal/icons/check.svg' : '/journal/icons/close.svg';
          img.alt = value;
          img.style.width = '12px';
          img.style.height = '12px';

          circle.appendChild(img);
          info.el.style.position = 'relative';
          info.el.appendChild(circle);
        }
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
  const workout = document.getElementById('selected-workout').value;
  const read = document.getElementById('selected-read').value;
  const called = document.getElementById('selected-called').value;

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  let imageUrl = "";

  // Get existing imageUrl if it exists
  const existingSnap = await getDoc(entryRef);
  if (existingSnap.exists()) {
    imageUrl = existingSnap.data().imageUrl || "";
  }

  if (imageFile) {
    try {
      const compressedFile = await imageCompression(imageFile, {
        maxSizeMB: 0.2,
        maxWidthOrHeight: 1000,
        useWebWorker: true,
      });

      const storageRef = ref(storage, `journalImages/${user.uid}_${date}`);
      await uploadBytes(storageRef, compressedFile);
      imageUrl = await getDownloadURL(storageRef); // Only updates if a new image was uploaded
    } catch (error) {
      console.error("Image compression/upload failed:", error);
      alert("Image upload failed.");
      return;
    }
  }

  await setDoc(entryRef, {
    userId: user.uid,
    date,
    mood,
    workout,
    read,
    called,
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
  
    // Mood UI...
    moodButtons.forEach(btn => {
      if (btn.dataset.mood === data.mood) {
        btn.classList.add('selected');
        selectedMoodInput.value = data.mood;
      } else {
        btn.classList.remove('selected');
      }
    });
  
    // Habit buttons (yes/no)
    const habits = [
      { key: 'workout', buttons: document.querySelectorAll('#workout-select .habit-button'), input: 'selected-workout' },
      { key: 'read', buttons: document.querySelectorAll('#read-select .habit-button'), input: 'selected-read' },
      { key: 'called', buttons: document.querySelectorAll('#called-select .habit-button'), input: 'selected-called' }
    ];
  
    habits.forEach(({ key, buttons, input }) => {
      buttons.forEach(btn => {
        if (data[key] === btn.dataset.value) {
          btn.classList.add('selected');
          document.getElementById(input).value = btn.dataset.value;
        } else {
          btn.classList.remove('selected');
        }
      });
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
    // Clear UI states if no data exists
    moodButtons.forEach(btn => btn.classList.remove('selected'));
    selectedMoodInput.value = '';

    const habits = [
      { input: 'selected-workout', buttons: document.querySelectorAll('#workout-select .habit-button') },
      { input: 'selected-read', buttons: document.querySelectorAll('#read-select .habit-button') },
      { input: 'selected-called', buttons: document.querySelectorAll('#called-select .habit-button') }
    ];
    
    habits.forEach(({ buttons, input }) => {
      buttons.forEach(btn => btn.classList.remove('selected'));
      document.getElementById(input).value = '';
    });
    

    document.getElementById('description').value = '';
    imgPreview.src = '';
    imgPreview.style.display = 'none';
    document.getElementById('image-preview-wrapper').style.display = 'none';
    document.getElementById('upload-label').style.display = 'inline-block';
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

document.getElementById('view-mode-selector').addEventListener('change', (e) => {
  currentViewMode = e.target.value;
  renderCalendar();
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


const themeMeta = document.querySelector('meta[name="theme-color"]');
const viewModeSelector = document.getElementById('view-mode-selector');
const authModal = document.getElementById('auth-modal');
const journalModal = document.getElementById('journal-modal');

function setThemeColor(color) {
  if (themeMeta) {
    themeMeta.setAttribute("content", color);
  }
}

function updateUIState() {
  if (authModal.style.display === 'flex') {
    setThemeColor('#f4eefe');
    viewModeSelector.style.visibility = 'visible';
    viewModeSelector.style.opacity = '1';
  } else if (journalModal.style.display === 'flex') {
    setThemeColor('#fffdfc');
    viewModeSelector.style.visibility = 'hidden';
    viewModeSelector.style.opacity = '0';
  } else {
    setThemeColor('#ffd3ce');
    viewModeSelector.style.visibility = 'visible';
    viewModeSelector.style.opacity = '1';
  }
}


// Use MutationObserver to detect modal open/close changes
const observer = new MutationObserver(updateUIState);

observer.observe(authModal, { attributes: true, attributeFilter: ['style'] });
observer.observe(journalModal, { attributes: true, attributeFilter: ['style'] });


// journal arrows
function changeDateBy(days) {
  const current = new Date(selectedDate);
  current.setDate(current.getDate() + days);
  const newDateStr = current.toISOString().split('T')[0];
  selectedDate = newDateStr;
  openJournalModal(newDateStr); // This will reload modal contents
}

document.getElementById('prev-date').addEventListener('click', () => {
  changeDateBy(-1);
});

document.getElementById('next-date').addEventListener('click', () => {
  changeDateBy(1);
});

// yes / no 
['workout', 'read', 'called'].forEach(id => {
  const buttons = document.querySelectorAll(`#${id}-select .habit-button`);
  const hiddenInput = document.getElementById(`selected-${id}`);
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
      hiddenInput.value = button.dataset.value || button.dataset.workout;
    });
  });
});

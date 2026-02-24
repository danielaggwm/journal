import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

import {
  doc, setDoc, getDoc, deleteDoc,
  query, collection, where, getDocs 
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

let auth; 
let calendar; 
let currentViewMode = 'image';
let journalEntriesWithImages = []; 
let currentImageIndex = 0;

let lastIsMobile = window.innerWidth <= 410;

// This will re-render the calendar (and fire datesSet) whenever we cross 410px.
window.addEventListener('resize', () => {
  const nowMobile = window.innerWidth <= 410;
  if (nowMobile !== lastIsMobile) {
    lastIsMobile = nowMobile;
    renderCalendar();
  }
});


async function renderCalendar() {
  const calendarEl = document.getElementById('calendar');

  if (calendar) {
    calendar.destroy();
  }

  const user = auth.currentUser;
  if (!user) return;

  // Fetch latest habit labels
  const habitDocRef = doc(db, "habitLabels", user.uid);
  const docSnap = await getDoc(habitDocRef);
  const habitLabels = docSnap.exists() ? docSnap.data() : {
    habit1: 'Worked out?',
    habit2: 'Read a book?',
    habit3: 'Called your parents?'
  };

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    customButtons: {
      viewModeSelector: {
        text: '',
        click: () => {}
      }
    },
    headerToolbar: {
      start: 'viewModeSelector',
      center: 'title',
      end: 'today prev,next'
    },
    dateClick: function(info) {
      openJournalModal(info.dateStr);
    },
    dayCellDidMount: async function(info) {
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

      if (['habit1', 'habit2', 'habit3'].includes(currentViewMode)) {
        let value = '';
        let habitLabelInEntry = '';
      
        if (data.habits?.[currentViewMode]) {
          value = data.habits[currentViewMode].value;
          habitLabelInEntry = data.habits[currentViewMode].label || '';
        } else {
          const fallbackKeys = { habit1: 'workout', habit2: 'read', habit3: 'called' };
          value = data[fallbackKeys[currentViewMode]] || '';
          habitLabelInEntry = ''; // No label saved in old data
        }
      
        const originalLabels = {
          habit1: 'Worked out?',
          habit2: 'Read a book?',
          habit3: 'Called your parents?'
        };
      
        // Only show mark if:
        // 1) label exists and matches current label OR
        // 2) no label saved but current label is the original default label
        const labelMatches =
          habitLabelInEntry === habitLabels[currentViewMode] ||
          (habitLabelInEntry === '' && habitLabels[currentViewMode] === originalLabels[currentViewMode]);
      
        if (labelMatches) {
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
      
      
      
    },
    datesSet: () => {
      if (window.innerWidth > 410) return;

      const toolbar = document.querySelector('.fc-header-toolbar');
      if (!toolbar) return;

      const chunks = Array.from(toolbar.querySelectorAll('.fc-toolbar-chunk'));
      if (chunks.length < 3) return;

      const [chunk1, chunk2, chunk3] = chunks;

      const oldWrapper = toolbar.querySelector('.fc-toolbar-chunk-row');
      if (oldWrapper) oldWrapper.remove();
      chunks.forEach(c => c.remove());

      const wrapper = document.createElement('div');
      wrapper.classList.add('fc-toolbar-chunk-row');
      wrapper.style.display = 'flex';
      wrapper.style.justifyContent = 'center';
      wrapper.style.gap = '1rem';
      wrapper.style.width = '100%';
      wrapper.style.marginBottom = '0.5rem';
      wrapper.appendChild(chunk1);
      wrapper.appendChild(chunk3);

      toolbar.appendChild(chunk2);
      toolbar.appendChild(wrapper);
    }
  });

  calendar.render();

  // Inject filter dropdown into custom button
  setTimeout(() => {
    const button = document.querySelector('.fc-viewModeSelector-button');
    if (!button || button.querySelector('.filter-dropdown-container')) return;

    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'filter-dropdown-container';
    dropdownContainer.style.display = 'inline-block';
    dropdownContainer.style.marginLeft = '20px';

    const select = document.createElement('select');
    select.className = 'inline-dropdown';

    select.innerHTML = `
      <option value="image" ${currentViewMode === 'image' ? 'selected' : ''}>Image</option>
      <option value="mood" ${currentViewMode === 'mood' ? 'selected' : ''}>Mood</option>
      <option value="habit1" ${currentViewMode === 'habit1' ? 'selected' : ''}>${habitLabels.habit1}</option>
      <option value="habit2" ${currentViewMode === 'habit2' ? 'selected' : ''}>${habitLabels.habit2}</option>
      <option value="habit3" ${currentViewMode === 'habit3' ? 'selected' : ''}>${
        habitLabels.habit3 === 'Called your parents?' ? 'Called parents?' : habitLabels.habit3
      }</option>  
    `;

    select.addEventListener('change', e => {
      currentViewMode = e.target.value;
      renderCalendar(); // Refresh view with new mode
    });

    dropdownContainer.appendChild(select);
    button.appendChild(dropdownContainer);
  }, 0);
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

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  let imageUrl = "";

  // Get existing imageUrl if it exists
  const existingSnap = await getDoc(entryRef);
  if (existingSnap.exists()) {
    imageUrl = existingSnap.data().imageUrl || "";
  }

  // Handle image upload
  if (imageFile) {
    try {
      const compressedFile = await imageCompression(imageFile, {
        maxSizeMB: 0.2,
        maxWidthOrHeight: 1000,
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

  // Build habits object
  const habitKeys = ['habit1', 'habit2', 'habit3'];
  const habits = {};

  habitKeys.forEach(habitId => {
    const labelEl = document.querySelector(`.habit-label[data-habit="${habitId}"]`);
    const hiddenInput = document.getElementById(`selected-${habitId}`);
    const label = labelEl?.textContent?.trim() || '';
    const value = hiddenInput?.value || '';
    habits[habitId] = { label, value };
  });

  // ✅ Save to Firestore (await this)
  await setDoc(entryRef, {
    userId: user.uid,
    date,
    mood,
    description,
    imageUrl,
    habits,
    timestamp: new Date()
  });

  // ✅ Close modal immediately after save
  document.getElementById('journal-modal').style.display = 'none';

  // 🔥 Kick off cache refresh in background (don’t await)
  (async () => {
    try {
      const token = await user.getIdToken();
      await fetch("https://journal-search-711305745141.us-central1.run.app/refresh_entries", {
        method: "POST",
        headers: {
          "Authorization": token,
          "Content-Type": "application/json"
        }
      });
      console.log("Cache refreshed");
    } catch (err) {
      console.error("Cache refresh failed:", err);
    }
  })();
}


async function loadJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return;

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  const docSnap = await getDoc(entryRef);
  const imgPreview = document.getElementById('image-preview');

  const habitKeys = ['habit1', 'habit2', 'habit3'];
  const fallbackKeys = {
    habit1: 'workout',
    habit2: 'read',
    habit3: 'called'
  };
  const defaultLabels = {
    habit1: 'Worked out?',
    habit2: 'Read a book?',
    habit3: 'Called your parents?'
  };

  if (docSnap.exists()) {
    const data = docSnap.data();

    // Mood selection
    moodButtons.forEach(btn => {
      if (btn.dataset.mood === data.mood) {
        btn.classList.add('selected');
        selectedMoodInput.value = data.mood;
      } else {
        btn.classList.remove('selected');
      }
    });

    // Load from journal entry (old or new structure)
    habitKeys.forEach(habitId => {
      const labelEl = document.querySelector(`.habit-label[data-habit="${habitId}"]`);
      const buttons = document.querySelectorAll(`#${habitId}-select .habit-button`);
      const hiddenInput = document.getElementById(`selected-${habitId}`);

      const fallbackValue = data[fallbackKeys[habitId]] || '';
      const habitData = data.habits?.[habitId] || {
        label: defaultLabels[habitId],
        value: fallbackValue
      };

      if (labelEl) labelEl.textContent = habitData.label;

      buttons.forEach(btn => {
        if (btn.dataset.value === habitData.value) {
          btn.classList.add('selected');
          hiddenInput.value = habitData.value;
        } else {
          btn.classList.remove('selected');
        }
      });
    });

    document.getElementById('description').value = data.description || '';

    // Image
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
    // === No entry yet — use latest habit labels ===

    const habitLabelsRef = doc(db, "habitLabels", user.uid);
    const labelSnap = await getDoc(habitLabelsRef);
    const latestLabels = labelSnap.exists() ? labelSnap.data() : defaultLabels;

    // Mood
    moodButtons.forEach(btn => btn.classList.remove('selected'));
    selectedMoodInput.value = '';

    // Habits
    habitKeys.forEach(habitId => {
      const labelEl = document.querySelector(`.habit-label[data-habit="${habitId}"]`);
      const buttons = document.querySelectorAll(`#${habitId}-select .habit-button`);
      const hiddenInput = document.getElementById(`selected-${habitId}`);

      if (labelEl) labelEl.textContent = latestLabels[habitId] || defaultLabels[habitId];

      buttons.forEach(btn => btn.classList.remove('selected'));
      if (hiddenInput) hiddenInput.value = '';
    });

    // Description & image
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

let isFetchingEntries = false;

async function fetchEntriesWithImages() {
  if (isFetchingEntries) return;
  isFetchingEntries = true;
  
  const user = auth.currentUser;
  if (!user) {
    isFetchingEntries = false;
    return;
  }

  try {
    const q = query(
      collection(db, "journalEntries"),
      where("userId", "==", user.uid),
      where("imageUrl", "!=", "")
    );
    const querySnapshot = await getDocs(q);

    journalEntriesWithImages = querySnapshot.docs.map(doc => ({
      id: doc.id,
      date: doc.data().date,
      imageUrl: doc.data().imageUrl
    })).sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date descending
    
    console.log('Fetched', journalEntriesWithImages.length, 'entries with images');
  } catch (error) {
    console.error("Error fetching entries with images:", error);
  } finally {
    isFetchingEntries = false;
  }
}


// reset password

import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Forgot password link
document.getElementById('forgot-password').addEventListener('click', (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value;

  if (!email) {
    alert("Please enter your email");
    return;
  }

  sendPasswordResetEmail(auth, email)
    .then(() => {
      alert("Check your inbox (or spam) for a reset link");
    })
    .catch((err) => {
      alert(err.message);
    });
});


document.addEventListener('DOMContentLoaded', () => {
  renderCalendar();
  // —————— Elements ——————
  const menuButton    = document.getElementById('menu-toggle');
  const menuWrapper   = document.querySelector('.menu-wrapper');
  const menuLinks     = document.querySelectorAll('.menu-items a');
  const journalModal  = document.getElementById('journal-modal');
  const closeModalBtn = document.getElementById('close-modal');
  const authModal     = document.getElementById('auth-modal');

  auth = window.firebaseApp?.auth;
  if (!auth) return console.error("Firebase auth not initialized.");

  // —————— MENU: open/close toggle ——————
  menuButton.addEventListener('click', () => {
    menuButton.classList.toggle('open');
    menuWrapper.classList.toggle('open');
  });

  // —————— MENU: collapse on any link click ——————
  menuLinks.forEach(link => {
    link.addEventListener('click', () => {
      menuButton.classList.remove('open');
      menuWrapper.classList.remove('open');
    });
  });

  // —————— AUTH: Signup, Login, Logout ——————
  document.getElementById('signup').addEventListener('click', () => {
    const email = document.getElementById('email').value.trim();
    const pass  = document.getElementById('password').value.trim();

    // Friendly validation first
    if (!email || !pass) {
      alert("Enter your email and create a password to sign up.");
      return;
    }

    createUserWithEmailAndPassword(auth, email, pass)
      .then(() => alert("Signup successful!"))
      .catch(err => alert(err.message));
  });

  document.getElementById('login').addEventListener('click', () => {
    const email = document.getElementById('email').value;
    const pass  = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, email, pass)
      .then(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' }); // scroll to top
      })
      .catch(err => alert(err.message));
  });  

  document.getElementById('logout').addEventListener('click', e => {
    e.preventDefault();
    // collapse the menu before logging out
    menuButton.classList.remove('open');
    menuWrapper.classList.remove('open');
    signOut(auth);
  });

  // —————— AUTH STATE: show/hide UI ——————
  onAuthStateChanged(auth, user => {
    if (user) {
      authModal.style.display = 'none';
      menuWrapper.style.display = 'flex';
      document.getElementById('calendar').style.display = 'block';
      fetchEntriesWithImages(); // Add this line
      renderCalendar();
    } else {
      authModal.style.display = 'flex';
      menuWrapper.style.display = 'none';
      document.getElementById('calendar').style.display = 'none';
      journalEntriesWithImages = []; // Clear when logged out
    }
  });
  

  // —————— JOURNAL MODAL: open/close ——————
  window.openJournalModal = dateStr => {
    // your existing logic to populate the modal...
    journalModal.style.display = 'flex';
    // hide the menu when modal is open
    menuButton.classList.remove('open');
    menuWrapper.classList.remove('open');
  };

  closeModalBtn.addEventListener('click', () => {
    journalModal.style.display = 'none';
    // restore menu visibility (if user is signed in)
    if (auth.currentUser) {
      menuWrapper.style.display = 'flex';
    }
  });
});

// PRELOAD SEARCH AI
(async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();
    await fetch('https://journal-search-711305745141.us-central1.run.app/preload_entries', {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });
    console.log("Journal entries preloading triggered");
  } catch (err) {
    console.warn("Preload failed:", err);
  }
})();


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

// Function to disable scrolling
function disableBodyScroll() {
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
}

// Function to enable scrolling
function enableBodyScroll() {
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
}

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

// imagePreview.addEventListener('click', () => {
//   fullImage.src = imagePreview.src;
//   imageOverlay.style.display = 'flex';
// });

imagePreview.addEventListener('click', async () => {
  const currentImageSrc = imagePreview.src;
  
  // If we haven't loaded entries yet or the current image isn't in our list
  if (journalEntriesWithImages.length === 0 || 
      !journalEntriesWithImages.some(entry => entry.imageUrl === currentImageSrc)) {
    // Create a temporary entry for the current image
    fullImage.src = currentImageSrc;
    imageOverlay.style.display = 'flex';
    disableBodyScroll(); 
    return;
  }

  currentImageIndex = journalEntriesWithImages.findIndex(entry => entry.imageUrl === currentImageSrc);
  
  if (currentImageIndex !== -1) {
    fullImage.src = journalEntriesWithImages[currentImageIndex].imageUrl;
    imageOverlay.style.display = 'flex';
    disableBodyScroll();
  }
});



imageOverlay.addEventListener('click', (e) => {
  if (e.target === imageOverlay) {
    imageOverlay.style.display = 'none';
    enableBodyScroll();
  }
});


document.getElementById('next-image').addEventListener('click', () => {
  if (currentImageIndex > 0) {
    currentImageIndex--;
    showEntryAtCurrentIndex();
  }
});

document.getElementById('prev-image').addEventListener('click', () => {
  if (currentImageIndex < journalEntriesWithImages.length - 1) {
    currentImageIndex++;
    showEntryAtCurrentIndex();
  }
});

async function showEntryAtCurrentIndex() {
  if (currentImageIndex < 0 || currentImageIndex >= journalEntriesWithImages.length) return;

  const entry = journalEntriesWithImages[currentImageIndex];
  if (entry) {
    fullImage.src = entry.imageUrl;
    
    if (selectedDate !== entry.date) {
      selectedDate = entry.date;
      
      // Format the new date
      const [year, month, day] = entry.date.split("-");
      const localDate = new Date(Number(year), Number(month) - 1, Number(day));
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      const formattedDate = localDate.toLocaleDateString('en-US', options);
      
      // Update the date label
      document.getElementById('journal-date-label').textContent = formattedDate;
      
      // Load the journal entry
      await loadJournalEntry(entry.date);
    }
  }
}

// Touch swipe variables
let touchStartX = 0;
let touchEndX = 0;

// Add these event listeners for touch support
fullImage.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

fullImage.addEventListener('touchend', (e) => {
  touchEndX = e.changedTouches[0].screenX;
  handleSwipe();
}, { passive: true });

// Keyboard navigation (keep your existing but fix the direction)
document.addEventListener('keydown', (e) => {
  if (imageOverlay.style.display === 'flex') {
    if (e.key === 'ArrowLeft') {
      document.getElementById('prev-image').click();  // Fixed direction
    } else if (e.key === 'ArrowRight') {
      document.getElementById('next-image').click();  // Fixed direction
    }
  }
});

function handleSwipe() {
  const swipeThreshold = 50; 
  
  // Swipe left 
  if (touchStartX - touchEndX > swipeThreshold) {
    document.getElementById('next-image').click();
  }
  // Swipe right 
  if (touchEndX - touchStartX > swipeThreshold) {
    document.getElementById('prev-image').click();
  }
}



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
  } else if (journalModal.style.display === 'flex') {
    setThemeColor('#fffdfc');
  } else {
    setThemeColor('#ffd3ce');
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
['habit1', 'habit2', 'habit3'].forEach(habitId => {
  const buttons = document.querySelectorAll(`#${habitId}-select .habit-button`);
  const hiddenInput = document.getElementById(`selected-${habitId}`);

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
      hiddenInput.value = button.dataset.value;
    });
  });
});




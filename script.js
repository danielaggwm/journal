import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";

import {
  doc, setDoc, getDoc, deleteDoc,
  query, collection, where, getDocs, documentId
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

let auth; 
let calendar; 
let currentViewMode = 'image';
let journalEntriesWithImages = [];
let currentImageIndex = 0;

// Guards against a slow network response overwriting the entry form.
// currentLoadToken: bumped every time we open/load an entry so an older,
//   still-in-flight fetch knows it's stale and bails out.
// descriptionDirty: true once the user has typed, so a late load can't
//   erase their words.
let currentLoadToken = 0;
let descriptionDirty = false;

// Latest habit labels, kept so cell decoration can run without re-fetching.
let currentHabitLabels = {
  habit1: 'Worked out?',
  habit2: 'Read a book?',
  habit3: 'Called your parents?'
};

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
  currentHabitLabels = habitLabels; // reused by cell decoration

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
    datesSet: (info) => {
      reflowMobileToolbar();
      // Paint instantly from whatever we already have cached...
      decorateVisibleCells();
      // ...then load the whole visible month in ONE query and repaint.
      loadMonthEntries(info.start, info.end).then(decorateVisibleCells);
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
      decorateVisibleCells(); // instant: no rebuild, no new query
    });

    dropdownContainer.appendChild(select);
    button.appendChild(dropdownContainer);
  }, 0);
}

// Local 'YYYY-MM-DD' key matching how entries are stored and how FullCalendar
// labels its day cells (data-date). Avoids UTC off-by-one shifts.
function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Fetch every entry in the visible date range with a SINGLE query, using a
// document-ID range (ids are `uid_YYYY-MM-DD`). This needs no composite index
// and only ever returns this user's own docs. Replaces ~42 per-cell reads.
async function loadMonthEntries(start, end) {
  const user = auth.currentUser;
  if (!user || !db) return;

  const startKey = toDateKey(start);
  // FullCalendar's `end` is exclusive, so step back one day for an inclusive key.
  const endInclusive = new Date(end.getTime() - 86400000);
  const endKey = toDateKey(endInclusive);

  try {
    const q = query(
      collection(db, "journalEntries"),
      where(documentId(), '>=', `${user.uid}_${startKey}`),
      where(documentId(), '<=', `${user.uid}_${endKey}`)
    );
    const snap = await getDocs(q);
    snap.forEach(d => { entryCache[d.data().date || d.id.split('_')[1]] = d.data(); });
  } catch (err) {
    console.warn('Month load failed:', err);
  }
}

// Draw images / mood dots / habit dots on the currently rendered day cells,
// reading only from entryCache (no network). Safe to call repeatedly.
function decorateVisibleCells() {
  const cells = document.querySelectorAll('#calendar .fc-daygrid-day');
  if (!cells.length) return;

  const colorMap = { good: 'green', sad: '#1e81b0', angry: 'red', excited: 'orange' };
  const originalLabels = {
    habit1: 'Worked out?',
    habit2: 'Read a book?',
    habit3: 'Called your parents?'
  };

  cells.forEach(cell => {
    const dateStr = cell.getAttribute('data-date');

    // Clear any previous decoration before (re)applying.
    cell.style.backgroundImage = '';
    cell.querySelectorAll('.entry-dot').forEach(el => el.remove());

    const data = dateStr ? entryCache[dateStr] : null;
    if (!data) return;

    cell.style.position = 'relative';

    if (currentViewMode === 'image' && data.imageUrl) {
      cell.style.backgroundImage = `url(${data.imageUrl})`;
      cell.style.backgroundSize = 'cover';
      cell.style.backgroundPosition = 'center';
      return;
    }

    if (currentViewMode === 'mood' && data.mood) {
      const dot = document.createElement('div');
      dot.className = 'entry-dot';
      dot.style.cssText =
        'position:absolute;bottom:5px;right:5px;width:12px;height:12px;border-radius:50%;';
      dot.style.backgroundColor = colorMap[data.mood] || 'gray';
      cell.appendChild(dot);
      return;
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
        habitLabelInEntry = '';
      }

      const labelMatches =
        habitLabelInEntry === currentHabitLabels[currentViewMode] ||
        (habitLabelInEntry === '' && currentHabitLabels[currentViewMode] === originalLabels[currentViewMode]);

      if (labelMatches && (value === 'yes' || value === 'no')) {
        const dot = document.createElement('div');
        dot.className = 'entry-dot';
        dot.style.cssText =
          'position:absolute;bottom:5px;right:5px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;';
        dot.style.backgroundColor = value === 'yes' ? 'green' : '#B22222';

        const img = document.createElement('img');
        img.src = value === 'yes' ? '/journal/icons/check.svg' : '/journal/icons/close.svg';
        img.alt = value;
        img.style.width = '12px';
        img.style.height = '12px';
        dot.appendChild(img);
        cell.appendChild(dot);
      }
    }
  });
}

// The mobile-only header reflow that used to live inline in datesSet.
function reflowMobileToolbar() {
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


// journal entry firebase logic
// Optional-chained so a slow/failed Firebase load doesn't throw here and
// blank the whole page — the loading screen + watchdog handle that case.
const db = window.firebaseApp?.db;
const storage = window.firebaseApp?.storage;


async function saveJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return alert("Not logged in");

  const mood = document.getElementById('selected-mood').value;
  const description = document.getElementById('description').value;
  const imageFile = document.getElementById('image-upload').files[0];

  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  let imageUrl = "";

  // Reuse the cached entry if we have it; only hit the network otherwise.
  if (entryCache[date]) {
    imageUrl = entryCache[date].imageUrl || "";
  } else {
    const existingSnap = await getDoc(entryRef);
    if (existingSnap.exists()) {
      imageUrl = existingSnap.data().imageUrl || "";
    }
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
  const entryData = {
    userId: user.uid,
    date,
    mood,
    description,
    imageUrl,
    habits,
    timestamp: new Date()
  };
  await setDoc(entryRef, entryData);

  // Keep the in-memory cache in sync so reopening shows the new content.
  entryCache[date] = entryData;

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


// In-memory cache of entries by date. The calendar loads each visible month
// in one query (loadMonthEntries) to draw its images/dots, so we reuse that
// same data to paint the entry modal instantly — no second network wait.
const entryCache = {};

const HABIT_KEYS = ['habit1', 'habit2', 'habit3'];
const HABIT_FALLBACK_KEYS = { habit1: 'workout', habit2: 'read', habit3: 'called' };
const DEFAULT_HABIT_LABELS = {
  habit1: 'Worked out?',
  habit2: 'Read a book?',
  habit3: 'Called your parents?'
};

function showEntryLoading(isLoading) {
  const el = document.getElementById('entry-loading');
  if (el) el.style.display = isLoading ? 'flex' : 'none';
}

// Populate the modal form from a saved entry object.
function applyEntryData(data) {
  const imgPreview = document.getElementById('image-preview');

  // Mood
  moodButtons.forEach(btn => {
    if (btn.dataset.mood === data.mood) {
      btn.classList.add('selected');
      selectedMoodInput.value = data.mood;
    } else {
      btn.classList.remove('selected');
    }
  });

  // Habits (supports both old and new data shapes)
  HABIT_KEYS.forEach(habitId => {
    const labelEl = document.querySelector(`.habit-label[data-habit="${habitId}"]`);
    const buttons = document.querySelectorAll(`#${habitId}-select .habit-button`);
    const hiddenInput = document.getElementById(`selected-${habitId}`);

    const fallbackValue = data[HABIT_FALLBACK_KEYS[habitId]] || '';
    const habitData = data.habits?.[habitId] || {
      label: DEFAULT_HABIT_LABELS[habitId],
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

  // Description — never overwrite text the user is actively typing.
  if (!descriptionDirty) {
    document.getElementById('description').value = data.description || '';
  }

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
}

// Reset the modal form for a day that has no saved entry yet.
function applyEmptyEntry(latestLabels) {
  const imgPreview = document.getElementById('image-preview');

  moodButtons.forEach(btn => btn.classList.remove('selected'));
  selectedMoodInput.value = '';

  HABIT_KEYS.forEach(habitId => {
    const labelEl = document.querySelector(`.habit-label[data-habit="${habitId}"]`);
    const buttons = document.querySelectorAll(`#${habitId}-select .habit-button`);
    const hiddenInput = document.getElementById(`selected-${habitId}`);

    if (labelEl) labelEl.textContent = latestLabels[habitId] || DEFAULT_HABIT_LABELS[habitId];

    buttons.forEach(btn => btn.classList.remove('selected'));
    if (hiddenInput) hiddenInput.value = '';
  });

  if (!descriptionDirty) {
    document.getElementById('description').value = '';
  }
  imgPreview.src = '';
  imgPreview.style.display = 'none';
  document.getElementById('image-preview-wrapper').style.display = 'none';
  document.getElementById('upload-label').style.display = 'inline-block';
  document.getElementById('clear-entry').style.display = 'none';
}

async function loadJournalEntry(date, loadToken = ++currentLoadToken) {
  const user = auth.currentUser;
  if (!user) return;

  // 1) Instant paint: if the calendar already loaded this day, show it now
  //    so the modal never opens blank.
  const cached = entryCache[date];
  if (cached) {
    showEntryLoading(false);
    applyEntryData(cached);
  } else {
    showEntryLoading(true);
  }

  // 2) Refresh from Firestore in the background so edits made on another
  //    device still show up. If the fetch is stale or fails, we simply keep
  //    whatever we already painted from cache.
  const entryRef = doc(db, "journalEntries", `${user.uid}_${date}`);
  let docSnap;
  try {
    docSnap = await getDoc(entryRef);
  } catch (err) {
    console.warn('Entry fetch failed; keeping cached view:', err);
    showEntryLoading(false);
    return;
  }

  // User navigated to another day while we waited — let that load own the UI.
  if (loadToken !== currentLoadToken) return;
  showEntryLoading(false);

  if (docSnap.exists()) {
    const data = docSnap.data();
    entryCache[date] = data;
    applyEntryData(data);
  } else {
    delete entryCache[date];

    // Brand-new entry — fetch the latest habit labels (defaults if it fails).
    let latestLabels = DEFAULT_HABIT_LABELS;
    try {
      const labelSnap = await getDoc(doc(db, "habitLabels", user.uid));
      if (loadToken !== currentLoadToken) return;
      if (labelSnap.exists()) latestLabels = labelSnap.data();
    } catch (err) {
      console.warn('Habit-label fetch failed; using defaults:', err);
    }
    applyEmptyEntry(latestLabels);
  }
}


async function clearJournalEntry(date) {
  const user = auth.currentUser;
  if (!user) return;

  const entryId = `${user.uid}_${date}`;
  await deleteDoc(doc(db, "journalEntries", entryId));

  // Drop it from the in-memory cache too.
  delete entryCache[date];

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
  // Calendar is rendered by onAuthStateChanged once `auth` is ready — calling
  // it here (before auth is assigned below) just threw a swallowed error.
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
  // onAuthStateChanged(auth, user => {
  //   const themeMeta = document.querySelector('meta[name="theme-color"]');
  //   if (user) {
  //     authModal.style.display = 'none';
  //     menuWrapper.style.display = 'flex';
  //     document.getElementById('calendar').style.display = 'block';
  //     // if (themeMeta) themeMeta.setAttribute('content', '#ffd3ce');
  //     // document.documentElement.style.backgroundColor = '#ffd3ce';
  //     fetchEntriesWithImages(); // Add this line
  //     renderCalendar();
  //   } else {
  //     authModal.style.display = 'flex';
  //     menuWrapper.style.display = 'none';
  //     document.getElementById('calendar').style.display = 'none';
  //     // if (themeMeta) themeMeta.setAttribute('content', '#f4eefe');
  //     // document.documentElement.style.backgroundColor = '#f4eefe';
  //     journalEntriesWithImages = []; // Clear when logged out
  //   }
  // });

  onAuthStateChanged(auth, user => {
  // Firebase is up and auth has resolved — tear down the loading screen and
  // stop the watchdog so it can't flip to the retry message.
  window.__appReady = true;
  const appLoader = document.getElementById('app-loader');
  if (appLoader) appLoader.style.display = 'none';

  if (user) {
    authModal.style.display = 'none';

    document.body.classList.remove('auth-open');
    setThemeColor('#ffe0dd');

    menuWrapper.style.display = 'flex';
    document.getElementById('calendar').style.display = 'block';

    // Note: the full image gallery (fetchEntriesWithImages) is now loaded
    // lazily the first time the image overlay is opened, so it no longer
    // competes with the calendar at startup.
    renderCalendar();

  } else {
    authModal.style.display = 'flex';

    document.body.classList.add('auth-open');
    setThemeColor('#f4f0fb');

    menuWrapper.style.display = 'none';
    document.getElementById('calendar').style.display = 'none';

    journalEntriesWithImages = [];
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
  descriptionDirty = false; // fresh entry view — nothing typed yet

  // Reset image preview UI
  document.getElementById('image-preview').src = '';
  document.getElementById('image-preview-wrapper').style.display = 'none';
  document.getElementById('upload-label').style.display = 'inline-block';

  // Show the modal
  document.getElementById('journal-modal').style.display = 'flex';

  
  moodButtons.forEach(btn => btn.classList.remove('selected'));
  selectedMoodInput.value = '';
  // Load saved data (if any). Use a fresh token so a slow response for a
  // previously opened date can't overwrite this one.
  loadJournalEntry(dateStr, ++currentLoadToken);
}

document.getElementById('close-modal').addEventListener('click', () => {
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

  // Lazily load the full image gallery the first time it's needed, so swiping
  // between photos works without paying that cost at startup.
  if (journalEntriesWithImages.length === 0) {
    fetchEntriesWithImages();
  }

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



// Mark the entry as "dirty" the moment the user types, so an in-flight
// load (slow on mobile) can never erase what they've written.
document.getElementById('description').addEventListener('input', () => {
  descriptionDirty = true;
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


// Single save handler. isSaving guards against the double-tap/double-submit
// that used to fire two uploads at once. saveJournalEntry closes the modal and
// updates entryCache; we just repaint the affected cell (no full rebuild).
let isSaving = false;
const saveEntryBtn = document.getElementById('save-entry');
saveEntryBtn.addEventListener('click', async () => {
  if (isSaving) return;
  isSaving = true;
  const originalLabel = saveEntryBtn.textContent;
  saveEntryBtn.disabled = true;
  saveEntryBtn.textContent = 'Saving…';
  try {
    await saveJournalEntry(selectedDate);
    decorateVisibleCells();
  } catch (err) {
    console.error('Save failed:', err);
    alert('Could not save your entry. Please try again.');
  } finally {
    isSaving = false;
    saveEntryBtn.disabled = false;
    saveEntryBtn.textContent = originalLabel;
  }
});

document.getElementById('clear-entry').addEventListener('click', async () => {
  await clearJournalEntry(selectedDate);
  document.getElementById('journal-modal').style.display = 'none';
  decorateVisibleCells(); // repaint to remove the dot/image
});


const themeMeta = document.querySelector('meta[name="theme-color"]');
const authModal = document.getElementById('auth-modal');
const journalModal = document.getElementById('journal-modal');

// function setThemeColor(color) {
//   if (themeMeta) {
//     themeMeta.setAttribute("content", color);
//   }
//   document.documentElement.style.backgroundColor = color;
// }

function setThemeColor(color) {
  const themeMeta = document.getElementById("theme-color-meta");

  if (themeMeta) {
    themeMeta.setAttribute("content", color);
  }

  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
}

function updateUIState() {
  const isMobile = window.innerWidth <= 480;
  const lockScroll = (locked) => {
    document.body.style.position = locked ? 'fixed' : '';
    document.body.style.width = locked ? '100%' : '';
    document.body.style.overflowY = locked ? 'hidden' : '';
    document.documentElement.style.overflowY = locked ? 'hidden' : '';
  };
  if (authModal.style.display === 'flex') {
    setThemeColor('#f4f0fb');
    lockScroll(isMobile);
  } else if (journalModal.style.display === 'flex') {
    setThemeColor('#fffdfc');
    lockScroll(false);
  } else {
    setThemeColor('#ffe0dd');
    lockScroll(isMobile);
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




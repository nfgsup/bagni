import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, push, set, remove, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-SDrNNtjh3RK8hITT5TVVgvAyg8tmDtk",
  authDomain: "bagni-22a78.firebaseapp.com",
  databaseURL: "https://bagni-22a78-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bagni-22a78",
  storageBucket: "bagni-22a78.firebasestorage.app",
  messagingSenderId: "215221000312",
  appId: "1:215221000312:web:4c18be9c3a247d1f99758d"
};

let app;
let db;

try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
} catch (e) {
    console.error("Errore inizializzazione Firebase. Hai inserito la config?", e);
    document.getElementById('error-msg').textContent = "Configura Firebase in app.js!";
    document.getElementById('error-msg').style.display = 'block';
}

const queueRef = ref(db, 'bagno_queue');

let myKey = localStorage.getItem('bagno_my_key');
let myName = localStorage.getItem('bagno_my_name');

const statusEl = document.getElementById('status-indicator');
const currentUserMsg = document.getElementById('current-user-msg');
const usernameInput = document.getElementById('username');
const bookBtn = document.getElementById('book-btn');
const leaveBtn = document.getElementById('leave-btn');
const queueListEl = document.getElementById('queue-list');
const queueCountEl = document.getElementById('queue-count');
const errorMsg = document.getElementById('error-msg');

if (myName) usernameInput.value = myName;

onValue(queueRef, (snapshot) => {
    const data = snapshot.val();
    updateUI(data);
});

function updateUI(queueData) {
    queueListEl.innerHTML = '';
    
    if (!queueData) {
        setFreeStatus();
        return;
    }

    const queueArray = Object.entries(queueData)
        .map(([key, val]) => ({ key, ...val }))
        .sort((a, b) => a.key.localeCompare(b.key));
    
    const currentOccupant = queueArray[0];
    
    setOccupiedStatus(currentOccupant.name);

    queueCountEl.textContent = queueArray.length;
    
    queueArray.forEach((item, index) => {
        const li = document.createElement('li');
        const isMe = item.key === myKey;
        
        let text = `${index + 1}. ${item.name} ${isMe ? '(TU)' : ''}`;
        if (index === 0) text += ' - 🚽 IN BAGNO';
        else text += ' - ⏳ In attesa';

        li.textContent = text;
        if (isMe) li.style.fontWeight = 'bold';
        queueListEl.appendChild(li);
    });

    bookBtn.disabled = false;
    bookBtn.textContent = "Aggiungi " + (usernameInput.value || "persona") + " in coda";

    if (queueArray.length > 0) {
        leaveBtn.disabled = false;
        leaveBtn.textContent = `${currentOccupant.name} è ritornato (Libera)`;
        leaveBtn.style.backgroundColor = "#27ae60"; 
        
        leaveBtn.dataset.occupantKey = currentOccupant.key;
    } else {
        leaveBtn.disabled = true;
        leaveBtn.textContent = "Nessuno in bagno";
        leaveBtn.style.backgroundColor = "#95a5a6";
    }
}

function setFreeStatus() {
    statusEl.textContent = "LIBERO";
    statusEl.className = "status-free";
    currentUserMsg.textContent = "Il bagno è libero!";
    queueCountEl.textContent = "0";
    
    bookBtn.disabled = false;
    bookBtn.textContent = "Aggiungi in coda";
    leaveBtn.disabled = true;
    leaveBtn.textContent = "Nessuno in bagno";
}

function setOccupiedStatus(name) {
    statusEl.textContent = "OCCUPATO";
    statusEl.className = "status-occupied";
    currentUserMsg.textContent = `Occupato da: ${name}`;
}

usernameInput.addEventListener('input', (e) => {
    if(bookBtn.disabled === false) {
        bookBtn.textContent = "Aggiungi " + (e.target.value || "persona") + " in coda";
    }
});

bookBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) {
        errorMsg.textContent = "Inserisci il nome della persona!";
        errorMsg.style.display = 'block';
        return;
    }
    errorMsg.style.display = 'none';

    const newEntryRef = push(queueRef);
    set(newEntryRef, {
        name: name,
        timestamp: Date.now()
    }).then(() => {
        usernameInput.value = '';
        bookBtn.textContent = "Aggiungi persona in coda";
    }).catch(err => {
        console.error(err);
        errorMsg.textContent = "Errore di connessione.";
        errorMsg.style.display = 'block';
    });
});

leaveBtn.addEventListener('click', () => {
    const keyToRemove = leaveBtn.dataset.occupantKey;

    if (!keyToRemove) return;

    const entryRef = ref(db, `bagno_queue/${keyToRemove}`);
    remove(entryRef).catch(err => {
        console.error(err);
        alert("Errore durante la rimozione.");
    });
});

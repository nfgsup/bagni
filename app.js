import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, push, set, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-SDrNNtjh3RK8hITT5TVVgvAyg8tmDtk",
  authDomain: "bagni-22a78.firebaseapp.com",
  databaseURL: "https://bagni-22a78-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bagni-22a78",
  storageBucket: "bagni-22a78.firebasestorage.app",
  messagingSenderId: "215221000312",
  appId: "1:215221000312:web:4c18be9c3a247d1f99758d"
};

class BagnoApp {
    constructor() {
        this.app = initializeApp(firebaseConfig);
        this.db = getDatabase(this.app);

        this.refs = {
            queue: ref(this.db, 'bagno_queue'),
            maintenance: ref(this.db, 'bagno_maintenance')
        };

        this.ui = {
            statusEl: document.getElementById('status-indicator'),
            currentUserMsg: document.getElementById('current-user-msg'),
            usernameInput: document.getElementById('username'),
            bookBtn: document.getElementById('book-btn'),
            leaveBtn: document.getElementById('leave-btn'),
            maintBtn: document.getElementById('maintenance-btn'),
            queueListEl: document.getElementById('queue-list'),
            queueCountEl: document.getElementById('queue-count'),
            errorMsg: document.getElementById('error-msg'),
            timerDisplay: document.getElementById('timer-display')
        };

        this.state = {
            queue: [],
            maintenance: false,
            currentOccupant: null
        };

        this.init();
    }

    init() {
        // --- LISTENERS FIREBASE ---

        // 1. Coda
        onValue(this.refs.queue, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                this.state.queue = Object.entries(data)
                    .map(([key, val]) => ({ key, ...val }))
                    .sort((a, b) => a.key.localeCompare(b.key));
            } else {
                this.state.queue = [];
            }
            this.updateUI();
        });

        // 2. Stato Manutenzione
        onValue(this.refs.maintenance, (snapshot) => {
            this.state.maintenance = snapshot.val() || false;
            this.updateUI();
        });

        // --- EVENT LISTENERS DOM ---

        // Aggiungi
        this.ui.bookBtn.addEventListener('click', () => this.addToQueue());
        
        // Rimuovi (Libera)
        this.ui.leaveBtn.addEventListener('click', () => {
            if (this.state.currentOccupant) {
                this.removeFromQueue(this.state.currentOccupant);
            }
        });

        // Toggle Manutenzione
        this.ui.maintBtn.addEventListener('click', () => {
            set(this.refs.maintenance, !this.state.maintenance);
        });

        // Input label dinamica
        this.ui.usernameInput.addEventListener('input', (e) => {
            if (!this.ui.bookBtn.disabled) {
                this.ui.bookBtn.textContent = `Aggiungi ${e.target.value.trim() || "persona"} in coda`;
            }
        });

        // Timer ogni secondo
        setInterval(() => this.tickTimer(), 1000);
    }

    addToQueue() {
        const name = this.ui.usernameInput.value.trim();
        if (!name) {
            this.showError("Inserisci un nome valido!");
            return;
        }
        this.hideError();

        push(this.refs.queue, {
            name: name,
            timestamp: Date.now()
        }).then(() => {
            this.ui.usernameInput.value = '';
            this.ui.bookBtn.textContent = "Aggiungi persona in coda";
        }).catch(err => {
            console.error(err);
            this.showError("Errore di connessione.");
        });
    }

    removeFromQueue(occupant) {
        remove(ref(this.db, `bagno_queue/${occupant.key}`))
            .catch(err => {
                console.error(err);
                this.showError("Impossibile rimuovere dalla coda.");
            });
    }

    updateUI() {
        const { queue, maintenance } = this.state;
        
        this.state.currentOccupant = queue.length > 0 ? queue[0] : null;

        // Render Lista Coda
        this.ui.queueListEl.innerHTML = '';
        this.ui.queueCountEl.textContent = queue.length;

        queue.forEach((item, index) => {
            const li = document.createElement('li');
            const date = new Date(item.timestamp);
            const timeStr = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
            
            let text = `${index + 1}. ${item.name} <span class="timer">(${timeStr})</span>`;
            
            if (index === 0) {
                text += ' - 🚽 <b>DENTRO</b>';
                li.style.backgroundColor = '#e8f6f3';
                li.style.borderLeft = '4px solid #2ecc71';
            } else {
                text += ' - ⏳ In attesa';
            }
            
            li.innerHTML = text;
            this.ui.queueListEl.appendChild(li);
        });

        if (maintenance) {
            this.setModeMaintenance();
        } else if (this.state.currentOccupant) {
            this.setModeOccupied(this.state.currentOccupant);
        } else {
            this.setModeFree();
        }
    }

    setModeFree() {
        this.ui.statusEl.textContent = "LIBERO";
        this.ui.statusEl.className = "status-free";
        this.ui.statusEl.classList.remove('status-alert');
        this.ui.currentUserMsg.textContent = "Il bagno è libero!";
        this.ui.timerDisplay.style.display = 'none';

        this.ui.bookBtn.disabled = false;
        this.ui.bookBtn.textContent = `Aggiungi ${this.ui.usernameInput.value || "persona"} in coda`;
        
        this.ui.leaveBtn.disabled = true;
        this.ui.leaveBtn.textContent = "Nessuno in bagno";
        this.ui.leaveBtn.style.backgroundColor = "#95a5a6";

        this.ui.maintBtn.textContent = "🛠️ Attiva Manutenzione";
        this.ui.maintBtn.style.backgroundColor = "#f1c40f";
    }

    setModeOccupied(occupant) {
        this.ui.statusEl.textContent = "OCCUPATO";
        this.ui.statusEl.className = "status-occupied";
        
        this.ui.currentUserMsg.textContent = `Occupato da: ${occupant.name}`;
        this.ui.timerDisplay.style.display = 'block';

        this.ui.bookBtn.disabled = false;
        this.ui.bookBtn.textContent = `Aggiungi ${this.ui.usernameInput.value || "persona"} in coda`;

        this.ui.leaveBtn.disabled = false;
        this.ui.leaveBtn.textContent = `${occupant.name} è ritornato (Libera)`;
        this.ui.leaveBtn.style.backgroundColor = "#27ae60";

        this.ui.maintBtn.textContent = "🛠️ Attiva Manutenzione";
        this.ui.maintBtn.style.backgroundColor = "#f1c40f";
    }

    setModeMaintenance() {
        this.ui.statusEl.textContent = "MANUTENZIONE";
        this.ui.statusEl.className = "status-maintenance";
        this.ui.statusEl.classList.remove('status-alert');
        this.ui.currentUserMsg.textContent = "Bagno fuori servizio 🛑";
        this.ui.timerDisplay.style.display = 'none';

        this.ui.bookBtn.disabled = true;
        this.ui.bookBtn.textContent = "In Manutenzione";

        this.ui.leaveBtn.disabled = true;
        this.ui.leaveBtn.textContent = "In Manutenzione";
        this.ui.leaveBtn.style.backgroundColor = "#95a5a6";

        this.ui.maintBtn.textContent = "✅ Termina Manutenzione";
        this.ui.maintBtn.style.backgroundColor = "#2ecc71";
    }

    tickTimer() {
        if (!this.state.currentOccupant || this.state.maintenance) return;

        const start = this.state.currentOccupant.timestamp;
        const now = Date.now();
        const diffInSeconds = Math.floor((now - start) / 1000);

        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;

        const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        this.ui.timerDisplay.textContent = timeString;

        if (minutes >= 5) {
            this.ui.statusEl.classList.add('status-alert');
            this.ui.statusEl.textContent = "OCCUPATO DA TROPPO"; 
            this.ui.timerDisplay.style.color = "#c0392b";
        } else {
            this.ui.statusEl.classList.remove('status-alert');
            this.ui.statusEl.textContent = "OCCUPATO"; 
            this.ui.timerDisplay.style.color = "#555";
        }
    }

    showError(msg) {
        this.ui.errorMsg.textContent = msg;
        this.ui.errorMsg.style.display = 'block';
        setTimeout(() => {
            this.ui.errorMsg.style.display = 'none';
        }, 3000);
    }

    hideError() {
        this.ui.errorMsg.style.display = 'none';
    }
}

new BagnoApp();

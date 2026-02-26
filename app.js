import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, push, set, remove, get, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-SDrNNtjh3RK8hITT5TVVgvAyg8tmDtk",
  authDomain: "bagni-22a78.firebaseapp.com",
  databaseURL: "https://bagni-22a78-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bagni-22a78",
  storageBucket: "bagni-22a78.firebasestorage.app",
  messagingSenderId: "215221000312",
  appId: "1:215221000312:web:4c18be9c3a247d1f99758d"
};

// Variabile globale per evitare update ciclici di set entryTime
let isUpdatingEntryTime = false;

// Configurazione Sicurezza Locale
const SECURITY = {
    PIN_MAINTENANCE: "1234", // Cambia questo in produzione!
    RATE_LIMIT_MS: 30000,   // 30 secondi tra azioni
};

class BagnoApp {
    constructor() {
        this.app = initializeApp(firebaseConfig);
        this.db = getDatabase(this.app);

        this.refs = {
            queue: ref(this.db, 'bagno_queue'),
            maintenance: ref(this.db, 'bagno_maintenance'),
            logs: ref(this.db, 'bagno_logs')
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
            timerDisplay: document.getElementById('timer-display'),
            logList: document.getElementById('log-list'),
            themeToggle: document.getElementById('theme-toggle')
        };

        this.state = {
            queue: [],
            maintenance: false,
            currentOccupant: null,
            lastActionTime: 0,
            amINext: false
        };

        this.init();
    }

    init() {
        console.log("App Bagno Avviata!");
        
        // Dark Mode Check
        if (localStorage.getItem('bagno_theme') === 'dark') {
            document.body.classList.add('dark-mode');
            this.ui.themeToggle.textContent = '☀️';
        }

        // --- LISTENERS FIREBASE ---

        // 1. Coda
        onValue(this.refs.queue, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                this.state.queue = Object.entries(data)
                    .map(([key, val]) => ({ key, ...val }))
                    .sort((a, b) => a.timestamp - b.timestamp); // Ordina per timestamp ASC (primo arrivato = primo in lista)
            } else {
                this.state.queue = [];
            }

            // --- LOGICA TIMER AVANZATO ---
            if (this.state.queue.length > 0) {
                const currentOccupant = this.state.queue[0];
                if (!currentOccupant.entryTime && !isUpdatingEntryTime) {
                    isUpdatingEntryTime = true;
                    // Se entryTime non c'è, lo settiamo ora (inizio occupazione)
                    const now = Date.now();
                    set(ref(this.db, `bagno_queue/${currentOccupant.key}/entryTime`), now)
                        .then(() => { isUpdatingEntryTime = false; });
                }
            }

            // Controlla se sono il prossimo (Notifica)
            this.checkIfNext();
            this.updateUI();
        });

        // 2. Stato Manutenzione
        onValue(this.refs.maintenance, (snapshot) => {
            this.state.maintenance = snapshot.val() || false;
            this.updateUI();
        });

        // 3. Log (Ultimi 10)
        const logsQuery = query(this.refs.logs, limitToLast(10));
        onValue(logsQuery, (snapshot) => {
            this.renderLogs(snapshot.val());
        });

        // --- EVENT LISTENERS DOM ---

        // Aggiungi
        this.ui.bookBtn.addEventListener('click', () => {
            if (this.checkRateLimit()) return;
            if (this.isUserSpamming()) {
                this.showError("Ha già una prenotazione attiva!");
                return;
            }
            this.addToQueue();
        });
        
        // Rimuovi (Libera o Esci)
        this.ui.leaveBtn.addEventListener('click', () => {
            // Permettiamo di uscire anche se rate limitato (emergenza)
            if (this.state.currentOccupant) {
                this.removeFromQueue(this.state.currentOccupant);
            }
        });

        // Toggle Manutenzione (con PIN)
        this.ui.maintBtn.addEventListener('click', () => {
            const pin = prompt("Inserisci PIN Manutenzione:");
            if (pin === SECURITY.PIN_MAINTENANCE) {
                const newState = !this.state.maintenance;
                set(this.refs.maintenance, newState);
                this.logAction("ADMIN", newState ? "Attivata Manutenzione" : "Disattivata Manutenzione");
            } else if (pin !== null) {
                alert("PIN Errato!");
            }
        });

        // Dark Mode Toggle
        this.ui.themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            this.ui.themeToggle.textContent = isDark ? '☀️' : '🌙';
            localStorage.setItem('bagno_theme', isDark ? 'dark' : 'light');
        });

        this.ui.usernameInput.addEventListener('input', (e) => {
            if (!this.ui.bookBtn.disabled) {
                this.ui.bookBtn.textContent = `Aggiungi ${e.target.value.trim() || "persona"} in coda`;
            }
        });

        // Request Notification Permission
        if ("Notification" in window) {
            Notification.requestPermission();
        }

        setInterval(() => this.tickTimer(), 1000);
    }

    addToQueue() {
        const name = this.ui.usernameInput.value.trim();
        if (!name) {
            this.showError("Inserisci un nome valido!");
            return;
        }
        
        // Anti-Duplicate Name Check (Client side soft check)
        const isDuplicateName = this.state.queue.some(item => item.name.toLowerCase() === name.toLowerCase());
        if (isDuplicateName) {
            this.showError("Questo nome è già in coda!");
            return;
        }

        this.hideError();
        this.updateRateLimit();

        // Salva myName localmente per sapere che ho prenotato io
        localStorage.setItem('bagno_my_active_name', name);

        push(this.refs.queue, {
            name: name,
            timestamp: Date.now()
        }).then(() => {
            this.logAction(name, "Si è aggiunto alla coda");
            this.ui.usernameInput.value = '';
            this.ui.bookBtn.textContent = "Aggiungi persona in coda";
        }).catch(err => {
            console.error(err);
            this.showError("Errore di connessione.");
        });
    }

    removeFromQueue(occupant) {
        remove(ref(this.db, `bagno_queue/${occupant.key}`))
            .then(() => {
                const action = (this.state.queue.length > 0 && this.state.queue[0].key === occupant.key) ? "Ha liberato il bagno" : "È uscito dalla coda";
                this.logAction(occupant.name, action);
                
                // Se ero io, pulisco la memoria locale
                if (localStorage.getItem('bagno_my_active_name') === occupant.name) {
                    localStorage.removeItem('bagno_my_active_name');
                }
            })
            .catch(err => {
                console.error(err);
                this.showError("Impossibile rimuovere.");
            });
    }

    logAction(who, what) {
        push(this.refs.logs, {
            who: who,
            what: what,
            timestamp: Date.now()
        });
    }

    renderLogs(logsData) {
        this.ui.logList.innerHTML = '';
        if (!logsData) return;

        Object.values(logsData).reverse().forEach(log => {
            const li = document.createElement('li');
            const date = new Date(log.timestamp);
            const timeStr = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
            li.textContent = `[${timeStr}] ${log.who}: ${log.what}`;
            this.ui.logList.appendChild(li);
        });
    }

    checkRateLimit() {
        const now = Date.now();
        if (now - this.state.lastActionTime < SECURITY.RATE_LIMIT_MS) {
            const waitSec = Math.ceil((SECURITY.RATE_LIMIT_MS - (now - this.state.lastActionTime)) / 1000);
            this.showError(`Aspetta ${waitSec}s prima di riprovare.`);
            return true;
        }
        return false;
    }

    updateRateLimit() {
        this.state.lastActionTime = Date.now();
    }

    isUserSpamming() {
        // Controllo se ho già un nome attivo salvato localmente che è ancora in coda
        const myActiveName = localStorage.getItem('bagno_my_active_name');
        if (!myActiveName) return false;

        // Verifico se quel nome è effettivamente ancora in coda
        return this.state.queue.some(item => item.name === myActiveName);
    }

    checkIfNext() {
        const myName = localStorage.getItem('bagno_my_active_name');
        // Se non ho un nome attivo o la coda è troppo corta (minimo 2 persone: 1 dentro, 1 fuori)
        if (!myName || this.state.queue.length < 2) return;

        // Code[0] è dentro, Code[1] è il prossimo
        const nextPerson = this.state.queue[1];
        
        // Controllo se IO sono Code[1] e non l'ho già notificato
        if (nextPerson.name === myName && !this.state.amINext) {
            this.state.amINext = true;
            this.sendNotification();
        } else if (nextPerson.name !== myName) {
            // Reset se non sono più il prossimo (es. qualcuno mi ha saltato o sono entrato)
            this.state.amINext = false;
        }
    }

    sendNotification() {
        if (Notification.permission === "granted") {
            new Notification("🚽 Bagno: Preparati!", {
                body: "Sei il prossimo in lista. Tieniti pronto!",
                icon: "https://cdn-icons-png.flaticon.com/512/2954/2954888.png"
            });
        }
    }

    updateUI() {
        // Re-sorting queue UI side just to be safe, although we sort on data fetch
        const { queue, maintenance } = this.state;
        this.state.currentOccupant = queue.length > 0 ? queue[0] : null;

        // Render Lista Coda
        this.ui.queueListEl.innerHTML = '';
        this.ui.queueCountEl.textContent = queue.length;

        queue.forEach((item, index) => {
            const li = document.createElement('li');
            const date = new Date(item.timestamp);
            const timeStr = date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
            
            let text = ``;
            
            if (index === 0) {
                text = `<b>${index + 1}. ${item.name}</b> <span class="timer">(${timeStr})</span> - 🚽 <b>DENTRO</b>`;
                li.style.backgroundColor = document.body.classList.contains('dark-mode') ? '#2ecc71' : '#e8f6f3';
                li.style.color = document.body.classList.contains('dark-mode') ? '#fff' : '#333';
                li.style.borderLeft = '4px solid #27ae60';
            } else {
                text = `${index + 1}. ${item.name} <span class="timer">(${timeStr})</span> - ⏳ In attesa`;
            }
            
            li.innerHTML = text;
            this.ui.queueListEl.appendChild(li);
        });

        if (maintenance) {
            this.setThemeMaintenance();
        } else if (this.state.currentOccupant) {
            this.setThemeOccupied(this.state.currentOccupant);
        } else {
            this.setThemeFree();
        }
    }
    
    // --- MODE SETTERS ---
    
    setThemeFree() {
        this.ui.statusEl.textContent = "LIBERO";
        this.ui.statusEl.className = "status-free"; // gestito da CSS
        this.ui.statusEl.style.backgroundColor = document.body.classList.contains('dark-mode') ? '#27ae60' : '#2ecc71';
        
        this.ui.currentUserMsg.textContent = "Il bagno è libero!";
        this.ui.timerDisplay.style.display = 'none';

        this.ui.bookBtn.disabled = false;
        
        this.ui.leaveBtn.disabled = true;
        this.ui.leaveBtn.textContent = "Nessuno in bagno";
        this.ui.leaveBtn.style.backgroundColor = "#95a5a6";

        this.ui.maintBtn.textContent = "🛠️ Attiva Manutenzione";
        this.ui.maintBtn.style.backgroundColor = "#f1c40f";
    }

    setThemeOccupied(occupant) {
        this.ui.statusEl.textContent = "OCCUPATO";
        this.ui.statusEl.className = "status-occupied";
        this.ui.statusEl.style.backgroundColor = document.body.classList.contains('dark-mode') ? '#c0392b' : '#e74c3c';
        
        this.ui.currentUserMsg.textContent = `Occupato da: ${occupant.name}`;
        this.ui.timerDisplay.style.display = 'block';

        this.ui.bookBtn.disabled = false;

        this.ui.leaveBtn.disabled = false;
        this.ui.leaveBtn.textContent = `${occupant.name} è ritornato (Libera)`;
        this.ui.leaveBtn.style.backgroundColor = "#27ae60";

        this.ui.maintBtn.textContent = "🛠️ Attiva Manutenzione";
        this.ui.maintBtn.style.backgroundColor = "#f1c40f";
    }

    setThemeMaintenance() {
        this.ui.statusEl.textContent = "MANUTENZIONE";
        this.ui.statusEl.style.backgroundColor = "#f39c12";

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
        // Nessuno dentro o in manutenzione
        if (!this.state.currentOccupant || this.state.maintenance) return;

        // Se non c'è entryTime (bug di sync o appena entrato), usa ora corrente come fallback visuale, ma non è ideale
        let start = this.state.currentOccupant.entryTime;
        if (!start) return; // Aspetta che Firebase sync entryTime

        const now = Date.now();
        const diffInSeconds = Math.max(0, Math.floor((now - start) / 1000));

        const minutes = Math.floor(diffInSeconds / 60);
        const seconds = diffInSeconds % 60;

        const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        this.ui.timerDisplay.textContent = timeString;

        // Gestione Colore Timer
        const isDark = document.body.classList.contains('dark-mode');
        
        if (minutes >= 5) {
            this.ui.statusEl.textContent = "OCCUPATO DA TROPPO"; 
            this.ui.timerDisplay.style.color = "#e74c3c"; // Sempre rosso se troppo tempo
        } else {
            this.ui.statusEl.textContent = "OCCUPATO"; 
            this.ui.timerDisplay.style.color = isDark ? '#ecf0f1' : '#555';
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

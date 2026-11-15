# Rocket Mink

## Sviluppo

Eseguire `npm ci`, copiare `.env.example` in `.env.local` e impostare l'URL e la chiave pubblicabile del progetto Supabase. Avviare con `npm run dev`. Le stesse variabili `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` sono necessarie nella build Vercel.

## Giocabilità e garage

La palla rallenta progressivamente con una resistenza indipendente dalla frequenza della simulazione. Il secondo salto con S/Freccia giù esegue un backflip: la spinta segue l'orientamento dell'auto e si somma alla velocità esistente. Il comando opposto consente di annullare la rotazione conservando la spinta.

Il turbo aumenta la spinta avvicinandosi alla velocità supersonica (circa 95 km/h), segnalata dall'indicatore vicino al tachimetro senza notifiche centrali. Le demolizioni richiedono un impatto frontale in avanti, a velocità supersonica e con sufficiente velocità di avvicinamento; contatti laterali, retromarcia e compagni di squadra producono urti normali. Le demolizioni mostrano BOOM! nel mondo 3D; tiro in porta, tiro aereo e parata hanno notifiche dedicate.

I replay durano 7 secondi, mostrano fino a 5,2 secondi di azione prima del gol e rallentano il finale. Spazio salta il replay; online il comando resta riservato all'host.

Nel garage sono disponibili tre preset, colore dei cerchioni indipendente e tre spoiler. Trascinare l'anteprima per ruotare e usare la rotella per lo zoom. Le scelte vengono salvate localmente e trasmesse agli altri giocatori.

Verifica: `npm test`, `npm run lint`, `npm run build`.

Salto e doppio salto: Spazio oppure clic sinistro sul campo; Ctrl sinistro o destro per drift e air roll. Shift e clic destro mantengono il turbo. I raccordi delle pareti sono più compatti, il soffitto è piatto e raggiungibile guidando con il turbo; la telecamera segue la normale della superficie e resta dentro l'arena e le porte.

La palla è limitata a 29 m/s (circa 104 km/h), sotto i 31 m/s del turbo. Tiri in porta e parate usano la traiettoria della fisica, inclusi i rimbalzi a terra; anche una deviazione laterale che impedisce il gol conta come parata. Gli aggiornamenti dell'host riportano il tempo dei comandi elaborati: l'ospite riapplica solo i comandi successivi, evitando correzioni verso posizioni vecchie. I test coprono ritardi simulati di 100 e 300 ms; il collaudo su due dispositivi resta distinto da queste simulazioni.

## God Mode e raccolta

Una stella arcobaleno compare tre volte per partita, a 10, 120 e 240 secondi di gioco effettivo; countdown, gol e replay non fanno avanzare la sequenza. Ogni stella resta disponibile per 20 secondi. Il primo giocatore che la raccoglie ottiene 6 secondi di invincibilità, carrozzeria e scia arcobaleno, velocità massima di 40 m/s (144 km/h) e demolizione degli avversari al contatto. I compagni e gli altri giocatori già potenziati restano protetti. Il kickoff annulla l'effetto e la rivincita riparte da zero. Comparsa, raccolta e demolizioni sono decise dall'host e sincronizzate con gli ospiti.

I pad turbo rilevano il passaggio dell'intera auto, anche sul bordo o fra due fotogrammi; gli anelli a terra indicano la zona di raccolta. Gli impatti sulla palla usano il punto sul telaio orientato, la velocità relativa del contatto, la rotazione e l'attrito, senza spinte artificiali sempre in avanti o verso l'alto.

## Connessione multiplayer

Supabase Realtime usa il canale `rocket-mink:signal:v1` per la ricerca delle stanze e la segnalazione WebRTC. I dati della partita viaggiano direttamente verso il browser dell'host, che esegue la simulazione. Non vengono create tabelle né modificate le configurazioni del progetto Supabase. Gli altri servizi dello stesso progetto condividono comunque limiti e consumo di Realtime.

Le stanze e la segnalazione sono pubbliche e la simulazione sul browser dell'host non è adatta a partite competitive o a dati sensibili. Quando l'host esce, la partita termina. Alcune reti bloccano le connessioni WebRTC dirette: questa versione usa STUN e non include un server TURN, quindi in quelle reti la connessione può fallire. L'host deve mantenere la scheda attiva per una simulazione regolare. Le stanze attive non accettano nuovi giocatori.

La stella ha un fascio luminoso di 16 metri, un indicatore con direzione e distanza e un segnale sonoro dedicato. La versione corrente si riconosce dalla sigla RM-20261115-01 nel menu e durante la partita.

Il relay temporaneo non chiude la negoziazione WebRTC: appena il canale diretto si apre, la partita lo usa automaticamente. I dati di movimento non passano sul canale affidabile e vengono scartati quando la coda supera un singolo aggiornamento; il relay invia 10 stati al secondo e viene sospeso quando il WebSocket non risulta connesso. Gli ospiti predicono solo la propria auto e i contatti con la palla, con estrapolazione degli altri oggetti limitata a 100 ms.

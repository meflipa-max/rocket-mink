# Rocket Mink

## Sviluppo

Eseguire `npm ci`, copiare `.env.example` in `.env.local` e impostare l'URL e la chiave pubblicabile del progetto Supabase. Avviare con `npm run dev`. Le stesse variabili `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` sono necessarie nella build Vercel.

## Giocabilità e garage

La palla rallenta progressivamente con una resistenza indipendente dalla frequenza della simulazione. Il secondo salto con S/Freccia giù esegue un backflip: la spinta segue l'orientamento dell'auto e si somma alla velocità esistente. Il comando opposto consente di annullare la rotazione conservando la spinta.

Il turbo aumenta la spinta avvicinandosi alla velocità supersonica (circa 95 km/h), segnalata dall'indicatore vicino al tachimetro senza notifiche centrali. Le demolizioni richiedono un impatto frontale in avanti, a velocità supersonica e con sufficiente velocità di avvicinamento; contatti laterali, retromarcia e compagni di squadra producono urti normali. Le demolizioni mostrano BOOM! nel mondo 3D; tiro in porta, tiro aereo e parata hanno notifiche dedicate.

I replay durano 7 secondi, mostrano fino a 5,2 secondi di azione prima del gol e rallentano il finale. Spazio salta il replay; online il comando resta riservato all'host.

Nel garage sono disponibili tre preset, colore dei cerchioni indipendente e tre spoiler. Trascinare l'anteprima per ruotare e usare la rotella per lo zoom. Le scelte vengono salvate localmente e trasmesse agli altri giocatori.

Verifica: `npm test`, `npm run lint`, `npm run build`.

## Connessione multiplayer

Supabase Realtime usa il canale `rocket-mink:signal:v1` per la ricerca delle stanze e la segnalazione WebRTC. I dati della partita viaggiano direttamente verso il browser dell'host, che esegue la simulazione. Non vengono create tabelle né modificate le configurazioni del progetto Supabase. Gli altri servizi dello stesso progetto condividono comunque limiti e consumo di Realtime.

Le stanze e la segnalazione sono pubbliche e la simulazione sul browser dell'host non è adatta a partite competitive o a dati sensibili. Quando l'host esce, la partita termina. Alcune reti bloccano le connessioni WebRTC dirette: questa versione usa STUN e non include un server TURN, quindi in quelle reti la connessione può fallire. L'host deve mantenere la scheda attiva per una simulazione regolare. Le stanze attive non accettano nuovi giocatori.

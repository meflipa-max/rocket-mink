# Rocket Mink

## Sviluppo

Eseguire `npm ci`, copiare `.env.example` in `.env.local` e impostare l'URL e la chiave pubblicabile del progetto Supabase. Avviare con `npm run dev`. Le stesse variabili `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` sono necessarie nella build Vercel.

## Multiplayer

Supabase Realtime usa il canale `rocket-mink:signal:v1` per la ricerca delle stanze e la segnalazione WebRTC. I dati della partita viaggiano direttamente verso il browser dell'host, che esegue la simulazione. Non vengono create tabelle né modificate le configurazioni del progetto Supabase. Gli altri servizi dello stesso progetto condividono comunque limiti e consumo di Realtime.

Le stanze e la segnalazione sono pubbliche e la simulazione sul browser dell'host non è adatta a partite competitive o a dati sensibili. Quando l'host esce, la partita termina. Alcune reti bloccano le connessioni WebRTC dirette: questa versione usa STUN e non include un server TURN, quindi in quelle reti la connessione può fallire. L'host deve mantenere la scheda attiva per una simulazione regolare. Le stanze attive non accettano nuovi giocatori.

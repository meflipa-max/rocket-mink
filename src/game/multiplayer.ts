import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { HostSimulation } from '../shared/hostSimulation';
import { DEFAULT_CUSTOMIZATION_BLUE, DEFAULT_CUSTOMIZATION_ORANGE, type LobbyPlayer, type RoomDetail, type RoomSummary, type PlayerInput, type Team } from '../shared/types';
import type { PlayerSeed } from '../shared/physics';

type Message = { event: string; payload?: any };
type Signal = { from: string; to?: string; kind: string; data?: any };
type Peer = { pc: RTCPeerConnection; channel?: RTCDataChannel; candidates: RTCIceCandidateInit[] };

// The project-wide channel only carries discovery and WebRTC signaling; gameplay is peer-to-peer.
export class MultiplayerClient {
  readonly id = crypto.randomUUID();
  connected = false;
  private handlers = new Map<string, Set<(value?: any) => void>>();
  private supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'rocket-mink-auth' },
  });
  private signal: RealtimeChannel;
  private peers = new Map<string, Peer>();
  private earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  private hostId = '';
  private room: RoomDetail | null = null;
  private found = new Map<string, RoomSummary>();
  private simulation: HostSimulation | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private pendingJoin: any;
  private closed = false;
  private joinTimeout?: ReturnType<typeof setTimeout>;

  constructor() {
    this.signal = this.supabase.channel('rocket-mink:signal:v1', { config: { broadcast: { self: false } } });
    this.signal.on('broadcast', { event: 'signal' }, ({ payload }) => { void this.onSignal(payload as Signal); });
    this.signal.subscribe((status) => {
      if (this.closed) return;
      if (status === 'SUBSCRIBED') { this.connected = true; this.fire('connect'); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        const wasConnected = this.connected; this.connected = false;
        this.fire(wasConnected ? 'disconnect' : 'connect_error');
      }
    });
  }
  on(event: string, fn: (value?: any) => void) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event)!.add(fn); return this; }
  private fire(event: string, value?: any) { this.handlers.get(event)?.forEach(fn => fn(value)); }
  private sendSignal(kind: string, data?: any, to?: string) {
    void this.signal.send({ type: 'broadcast', event: 'signal', payload: { from: this.id, to, kind, data } });
  }
  private announce() { if (this.room && this.hostId === this.id) this.sendSignal('room', this.summary()); }
  private summary(): RoomSummary { const r = this.room!; const { players, hostId, ...summary } = r; return summary; }
  private update() {
    if (!this.room) return;
    this.room.playerCount = this.room.players.length;
    this.broadcast('room:updated', this.room); this.announce();
  }
  private broadcast(event: string, payload?: any) {
    this.fire(event, payload === undefined ? undefined : structuredClone(payload));
    for (const peer of this.peers.values()) if (peer.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ event, payload }));
  }
  private sendPeer(id: string, event: string, payload?: any) {
    const channel = this.peers.get(id)?.channel;
    if (channel?.readyState === 'open') channel.send(JSON.stringify({ event, payload }));
  }
  private newPeer(id: string): Peer {
    this.peers.get(id)?.pc.close();
    const peer: Peer = { pc: new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }), candidates: this.earlyCandidates.get(id) || [] };
    this.earlyCandidates.delete(id);
    this.peers.set(id, peer);
    peer.pc.onicecandidate = e => { if (e.candidate) this.sendSignal('candidate', e.candidate.toJSON(), id); };
    peer.pc.ondatachannel = e => this.bindChannel(id, peer, e.channel);
    peer.pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.pc.connectionState)) this.peerLeft(id);
    };
    return peer;
  }
  private bindChannel(id: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.onopen = () => { if (this.hostId !== this.id) this.sendPeer(id, 'join', this.pendingJoin); };
    channel.onmessage = e => { try { this.onPeerMessage(id, JSON.parse(e.data) as Message); } catch { /* Ignore malformed messages. */ } };
    channel.onclose = () => this.peerLeft(id);
  }
  private peerLeft(id: string) {
    const peer = this.peers.get(id); if (!peer) return;
    this.peers.delete(id); peer.pc.close();
    if (this.hostId === this.id && this.room) {
      this.room.players = this.room.players.filter(p => p.id !== id);
      this.simulation?.removeInput(id);
      const car = this.simulation?.state.cars.find(c => c.id === id);
      if (car) car.isBot = true;
      this.update();
    } else if (id === this.hostId) { this.leave(); this.fire('disconnect'); if (this.connected) this.fire('connect'); }
  }
  private async onSignal(s: Signal) {
    if (!s || s.from === this.id || (s.to && s.to !== this.id)) return;
    try {
      if (s.kind === 'discover') { this.announce(); return; }
      if (s.kind === 'room' && s.data?.code) { this.found.set(s.data.code, s.data); this.fire('rooms:update', [...this.found.values()]); return; }
      if (s.kind === 'request' && this.hostId === this.id && this.room && this.room.code === s.data?.code) {
        if (this.room.players.length >= this.room.maxPlayers || this.room.inProgress) { this.sendSignal('reject', 'Stanza piena o partita già iniziata.', s.from); return; }
        const peer = this.newPeer(s.from); this.bindChannel(s.from, peer, peer.pc.createDataChannel('game'));
        await peer.pc.setLocalDescription(await peer.pc.createOffer()); this.sendSignal('offer', peer.pc.localDescription, s.from); return;
      }
      if (s.kind === 'reject') { this.fire('room:error', s.data); return; }
      if (s.kind === 'offer' && this.pendingJoin && !this.hostId) {
        this.hostId = s.from; const peer = this.newPeer(s.from);
        await peer.pc.setRemoteDescription(s.data); await this.flushCandidates(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer()); this.sendSignal('answer', peer.pc.localDescription, s.from); return;
      }
      const peer = this.peers.get(s.from);
      if (!peer) {
        if (s.kind === 'candidate' && s.to === this.id && this.pendingJoin) {
          const candidates = this.earlyCandidates.get(s.from) || [];
          if (candidates.length < 32) candidates.push(s.data);
          this.earlyCandidates.set(s.from, candidates);
        }
        return;
      }
      if (s.kind === 'answer') { await peer.pc.setRemoteDescription(s.data); await this.flushCandidates(peer); }
      if (s.kind === 'candidate') { if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(s.data); else peer.candidates.push(s.data); }
    } catch { this.fire('room:error', 'Connessione tra giocatori non riuscita. Riprova.'); }
  }
  private async flushCandidates(peer: Peer) { for (const c of peer.candidates.splice(0)) await peer.pc.addIceCandidate(c); }
  private onPeerMessage(id: string, msg: Message) {
    if (this.hostId !== this.id) {
      if (id !== this.hostId) return;
      if (msg.event === 'room:joined') { if (this.joinTimeout) clearTimeout(this.joinTimeout); this.pendingJoin = null; this.room = msg.payload; }
      if (msg.event === 'room:updated') this.room = msg.payload;
      this.fire(msg.event, msg.payload); return;
    }
    if (!this.room) return;
    if (msg.event === 'join') {
      if (this.room.players.some(p => p.id === id)) return;
      if (this.room.players.length >= this.room.maxPlayers || this.room.inProgress) { this.sendPeer(id, 'room:error', 'Stanza non disponibile.'); this.peers.get(id)?.pc.close(); return; }
      const blue = this.room.players.filter(p => p.team === 'blue').length;
      const orange = this.room.players.length - blue;
      const team: Team = blue <= orange ? 'blue' : 'orange';
      this.room.players.push({ id, name: String(msg.payload?.playerName || 'Pilota').slice(0,18), team, isHost: false, ready: true, customization: msg.payload?.customization || DEFAULT_CUSTOMIZATION_ORANGE });
      this.room.playerCount = this.room.players.length; this.sendPeer(id, 'room:joined', this.room); this.update(); return;
    }
    if (!this.room.players.some(p => p.id === id)) return;
    this.command(id, msg.event, msg.payload);
  }
  private command(id: string, event: string, data?: any) {
    const room = this.room; if (!room || this.hostId !== this.id) return;
    const player = room.players.find(p => p.id === id); if (!player) return;
    if (event === 'player:input') { this.simulation?.setInput(id, data as PlayerInput); return; }
    if (event === 'room:leave') { if (id === this.id) this.leave(); else this.peerLeft(id); return; }
    if (event === 'room:team' && (data?.team === 'blue' || data?.team === 'orange')) player.team = data.team;
    if (event === 'room:customize' && data?.customization) player.customization = data.customization;
    if (event === 'room:bots' && id === this.id) room.fillBots = !!data?.fillBots;
    if (event === 'room:arena' && id === this.id) room.arenaId = data?.arenaId;
    if ((event === 'match:start' || event === 'match:rematch') && id === this.id) { this.startMatch(); return; }
    if (event === 'chat:send') {
      const text = String(data?.text || '').trim().slice(0,64); if (text) this.broadcast('chat:message', { id: crypto.randomUUID(), playerName: player.name, team: player.team, text, timestamp: Date.now() }); return;
    }
    this.update();
  }
  private startMatch() {
    if (!this.room) return;
    if (this.timer) clearInterval(this.timer);
    const seeds: PlayerSeed[] = this.room.players.map(p => ({ id:p.id, name:p.name, team:p.team, customization:p.customization }));
    if (this.room.fillBots && this.room.mode !== 'freeplay') {
      for (const team of ['blue','orange'] as const) {
        const missing = Math.max(0, this.room.maxPlayers / 2 - seeds.filter(s => s.team === team).length);
        for (let i=0; i<missing; i++) seeds.push({id:`bot-${team}-${i}`, name:`Bot ${i+1}`, team, isBot:true, customization: team === 'blue' ? DEFAULT_CUSTOMIZATION_BLUE : DEFAULT_CUSTOMIZATION_ORANGE});
      }
    }
    this.simulation = new HostSimulation(this.room.mode, this.room.arenaId, seeds); this.room.inProgress = true;
    this.broadcast('match:started', this.simulation.state); this.update();
    let last = performance.now(), ticks = 0;
    this.timer = setInterval(() => {
      if (!this.simulation) return;
      const now = performance.now(); const events = this.simulation.step((now-last)/1000); last = now;
      if (events.length) this.broadcast('game:events', events);
      if (++ticks % 3 === 0) this.broadcast('game:state', this.simulation.state);
    }, 1000/60);
  }
  emit(event: string, data?: any) {
    if (event === 'rooms:list') { this.found.clear(); this.fire('rooms:update', []); this.sendSignal('discover'); this.announce(); return this; }
    if (event === 'room:create' || event === 'matchmaking:quick') {
      this.leave(); const code = crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase();
      const mode = data?.mode || '1v1'; const maxPlayers = mode === '3v3' ? 6 : mode === '2v2' ? 4 : 2;
      const player: LobbyPlayer = { id:this.id, name:String(data?.playerName || 'Pilota').slice(0,18), team:'blue', ready:true, isHost:true, customization:data?.customization || DEFAULT_CUSTOMIZATION_BLUE };
      this.hostId = this.id; this.room = { code, name:String(data?.roomName || 'Partita rapida').slice(0,30), mode, arenaId:data?.arenaId || 'dfh_night', fillBots:data?.fillBots !== false, playerCount:1, maxPlayers, inProgress:false, hostId:this.id, players:[player] };
      this.fire('room:joined', this.room); this.announce(); if (event === 'matchmaking:quick') this.startMatch(); return this;
    }
    if (event === 'room:join') {
      this.leave(); const code = String(data?.code || '').trim().toUpperCase(); this.pendingJoin = data;
      this.sendSignal('request', { code });
      this.joinTimeout = setTimeout(() => { if (this.pendingJoin) { this.leave(); this.fire('room:error','Stanza non trovata o connessione diretta non riuscita.'); } }, 15000); return this;
    }
    if (this.hostId === this.id) this.command(this.id,event,data);
    else if (this.hostId) { this.sendPeer(this.hostId,event,data); if (event === 'room:leave') this.leave(); }
    return this;
  }
  private leave() {
    if (this.timer) clearInterval(this.timer); if (this.joinTimeout) clearTimeout(this.joinTimeout);
    this.timer = undefined; this.simulation = null; this.room = null; this.pendingJoin = null; this.hostId = ''; this.earlyCandidates.clear();
    const peers = [...this.peers.values()]; this.peers.clear(); peers.forEach(p => p.pc.close());
  }
  disconnect() { this.closed = true; this.leave(); this.connected = false; void this.supabase.removeChannel(this.signal); }
}

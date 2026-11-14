import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { HostSimulation } from '../shared/hostSimulation';
import {
  DEFAULT_CUSTOMIZATION_BLUE,
  DEFAULT_CUSTOMIZATION_ORANGE,
  type LobbyPlayer,
  type PlayerInput,
  type RoomDetail,
  type RoomSummary,
  type Team,
} from '../shared/types';
import type { PlayerSeed } from '../shared/physics';
import {
  generateRoomCode,
  normalizeRoomCodeInput,
  pickBalancedTeam,
} from '../shared/roomHelpers';

type Message = { event: string; payload?: any };
type Signal = { from: string; to?: string; kind: string; data?: any };
type Peer = { pc: RTCPeerConnection; channel?: RTCDataChannel; candidates: RTCIceCandidateInit[] };

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

// The project-wide channel carries discovery and WebRTC signaling; gameplay prefers P2P DataChannel
// and falls back to a per-room Supabase Broadcast relay if WebRTC cannot establish a direct link.
export class MultiplayerClient {
  readonly id = crypto.randomUUID();
  connected = false;
  private handlers = new Map<string, Set<(value?: any) => void>>();
  private supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'rocket-mink-auth',
      },
    },
  );
  private signal: RealtimeChannel;
  private roomChannel: RealtimeChannel | null = null;
  private relayReady = false;
  private usingRelay = false;
  private relayPeers = new Set<string>();
  private peers = new Map<string, Peer>();
  private earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  private hostId = '';
  private room: RoomDetail | null = null;
  private found = new Map<string, RoomSummary>();
  private simulation: HostSimulation | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private pendingJoin: any = null;
  private queuedJoin: any = null;
  private closed = false;
  private joinTimeout?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private relayFallbackTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.signal = this.supabase.channel('rocket-mink:signal:v1', {
      config: { broadcast: { self: false } },
    });
    this.signal.on('broadcast', { event: 'signal' }, ({ payload }) => {
      void this.onSignal(payload as Signal);
    });
    this.signal.subscribe((status) => {
      if (this.closed) return;
      if (status === 'SUBSCRIBED') {
        this.connected = true;
        this.fire('connect');
        if (this.queuedJoin) {
          const queued = this.queuedJoin;
          this.queuedJoin = null;
          this.emit('room:join', queued);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        const wasConnected = this.connected;
        this.connected = false;
        this.fire(wasConnected ? 'disconnect' : 'connect_error');
      }
    });
  }

  on(event: string, fn: (value?: any) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  private fire(event: string, value?: any) {
    this.handlers.get(event)?.forEach((fn) => fn(value));
  }

  private sendSignal(kind: string, data?: any, to?: string) {
    void this.signal.send({
      type: 'broadcast',
      event: 'signal',
      payload: { from: this.id, to, kind, data },
    });
  }

  private announce() {
    if (this.room && this.hostId === this.id) {
      this.sendSignal('room', this.summary());
    }
  }

  private summary(): RoomSummary {
    const r = this.room!;
    const { players: _players, hostId: _hostId, ...summary } = r;
    return summary;
  }

  private update() {
    if (!this.room) return;
    this.room.playerCount = this.room.players.length;
    this.broadcast('room:updated', this.room);
    this.announce();
  }

  private sendRoomRelay(event: string, payload?: any, to?: string) {
    if (!this.roomChannel || !this.relayReady) return;
    void this.roomChannel.send({
      type: 'broadcast',
      event: 'msg',
      payload: { from: this.id, to, event, payload },
    });
  }

  private broadcast(event: string, payload?: any) {
    this.fire(event, payload === undefined ? undefined : structuredClone(payload));
    const serialized = JSON.stringify({ event, payload });
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === 'open') {
        peer.channel.send(serialized);
      }
    }
    if (this.relayPeers.size > 0) {
      this.sendRoomRelay(event, payload);
    }
  }

  private sendPeer(id: string, event: string, payload?: any) {
    if (this.relayPeers.has(id) || (this.usingRelay && id === this.hostId)) {
      this.sendRoomRelay(event, payload, id);
      return;
    }
    const channel = this.peers.get(id)?.channel;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify({ event, payload }));
    }
  }

  private openRoomChannel(code: string, onSubscribed?: () => void) {
    if (this.roomChannel) {
      void this.supabase.removeChannel(this.roomChannel);
      this.roomChannel = null;
      this.relayReady = false;
    }
    const channel = this.supabase.channel(`rocket-mink:room:${code}`, {
      config: { broadcast: { self: false } },
    });
    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (!payload || payload.from === this.id) return;
      if (payload.to && payload.to !== this.id) return;
      if (this.hostId === this.id) {
        if (payload.event === 'join') {
          this.relayPeers.add(payload.from);
          const existingPeer = this.peers.get(payload.from);
          if (existingPeer) {
            this.peers.delete(payload.from);
            existingPeer.pc.close();
          }
          this.handleJoin(payload.from, payload.payload);
          return;
        }
        if (this.relayPeers.has(payload.from)) {
          this.onPeerMessage(payload.from, { event: payload.event, payload: payload.payload });
        }
      } else {
        if (payload.event === 'room:joined' && payload.from) {
          this.hostId = payload.from;
        }
        if (payload.from && this.hostId && payload.from !== this.hostId) return;
        this.onPeerMessage(payload.from || this.hostId, {
          event: payload.event,
          payload: payload.payload,
        });
      }
    });
    channel.subscribe((status) => {
      if (this.closed || this.roomChannel !== channel) return;
      if (status === 'SUBSCRIBED') {
        this.relayReady = true;
        onSubscribed?.();
      }
    });
    this.roomChannel = channel;
  }

  private activateRelayFallback(code: string) {
    if (this.closed || this.usingRelay || !this.pendingJoin) return;
    this.usingRelay = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.relayFallbackTimer) {
      clearTimeout(this.relayFallbackTimer);
      this.relayFallbackTimer = undefined;
    }
    const peers = [...this.peers.values()];
    this.peers.clear();
    peers.forEach((p) => p.pc.close());

    const joinData = this.pendingJoin;
    this.openRoomChannel(code, () => {
      if (this.pendingJoin && this.usingRelay) {
        this.sendRoomRelay('join', joinData, this.hostId || undefined);
      }
    });
  }

  private newPeer(id: string): Peer {
    const oldPeer = this.peers.get(id);
    if (oldPeer) {
      this.peers.delete(id);
      oldPeer.pc.close();
    }
    const peer: Peer = {
      pc: new RTCPeerConnection(ICE_CONFIG),
      candidates: this.earlyCandidates.get(id) || [],
    };
    this.earlyCandidates.delete(id);
    this.peers.set(id, peer);
    peer.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal('candidate', e.candidate.toJSON(), id);
      }
    };
    peer.pc.ondatachannel = (e) => this.bindChannel(id, peer, e.channel);
    peer.pc.onconnectionstatechange = () => {
      if (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'closed') {
        if (this.pendingJoin && this.hostId !== this.id) {
          this.activateRelayFallback(this.pendingJoin.code);
        } else {
          this.peerLeft(id);
        }
      }
    };
    return peer;
  }

  private bindChannel(id: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.onopen = () => {
      if (this.hostId !== this.id && this.pendingJoin) {
        this.sendPeer(id, 'join', this.pendingJoin);
      }
    };
    channel.onmessage = (e) => {
      try {
        this.onPeerMessage(id, JSON.parse(e.data) as Message);
      } catch {
        // Ignore malformed messages.
      }
    };
    channel.onclose = () => {
      if (this.peers.get(id) === peer) {
        this.peerLeft(id);
      }
    };
  }

  private peerLeft(id: string) {
    const wasWebRtc = this.peers.delete(id);
    const wasRelay = this.relayPeers.delete(id);
    if (!wasWebRtc && !wasRelay) return;

    if (this.hostId === this.id && this.room) {
      this.room.players = this.room.players.filter((p) => p.id !== id);
      this.simulation?.demoteToBot(id);
      this.update();
    } else if (id === this.hostId) {
      this.leave();
      this.fire('room:error', "Connessione con l'host interrotta.");
      this.fire('disconnect');
      if (this.connected) this.fire('connect');
    }
  }

  private async onSignal(s: Signal) {
    if (!s || s.from === this.id || (s.to && s.to !== this.id)) return;
    try {
      if (s.kind === 'discover') {
        this.announce();
        return;
      }
      if (s.kind === 'room' && s.data?.code) {
        this.found.set(s.data.code, s.data);
        this.fire('rooms:update', [...this.found.values()]);
        return;
      }
      if (
        s.kind === 'request' &&
        this.hostId === this.id &&
        this.room &&
        this.room.code === s.data?.code
      ) {
        if (this.room.players.length >= this.room.maxPlayers) {
          this.sendSignal('reject', 'La stanza è al completo.', s.from);
          return;
        }
        const peer = this.newPeer(s.from);
        this.bindChannel(s.from, peer, peer.pc.createDataChannel('game'));
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        this.sendSignal(
          'offer',
          peer.pc.localDescription
            ? { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp }
            : offer,
          s.from,
        );
        return;
      }
      if (s.kind === 'reject') {
        if (this.pendingJoin) {
          this.leave();
          this.fire('room:error', s.data || 'Accesso alla stanza rifiutato.');
        }
        return;
      }
      if (s.kind === 'offer' && this.pendingJoin && !this.hostId && !this.usingRelay) {
        this.hostId = s.from;
        const peer = this.newPeer(s.from);
        await peer.pc.setRemoteDescription(s.data);
        await this.flushCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal(
          'answer',
          peer.pc.localDescription
            ? { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp }
            : answer,
          s.from,
        );
        return;
      }
      const peer = this.peers.get(s.from);
      if (!peer) {
        if (s.kind === 'candidate' && s.to === this.id && this.pendingJoin && !this.usingRelay) {
          const candidates = this.earlyCandidates.get(s.from) || [];
          if (candidates.length < 32) candidates.push(s.data);
          this.earlyCandidates.set(s.from, candidates);
        }
        return;
      }
      if (s.kind === 'answer') {
        await peer.pc.setRemoteDescription(s.data);
        await this.flushCandidates(peer);
      }
      if (s.kind === 'candidate') {
        if (peer.pc.remoteDescription) {
          try {
            await peer.pc.addIceCandidate(s.data);
          } catch {
            // Ignore incompatible ICE candidate.
          }
        } else {
          peer.candidates.push(s.data);
        }
      }
    } catch {
      if (this.pendingJoin && this.hostId !== this.id) {
        this.activateRelayFallback(this.pendingJoin.code);
      } else {
        this.fire('room:error', 'Connessione tra giocatori non riuscita. Riprova.');
      }
    }
  }

  private async flushCandidates(peer: Peer) {
    for (const c of peer.candidates.splice(0)) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
        // Ignore incompatible ICE candidate.
      }
    }
  }

  private handleJoin(id: string, payload: any) {
    if (!this.room) return;
    if (this.room.players.some((p) => p.id === id)) {
      this.sendPeer(id, 'room:joined', this.room);
      if (this.room.inProgress && this.simulation) {
        this.sendPeer(id, 'match:started', this.simulation.state);
      }
      return;
    }
    if (this.room.players.length >= this.room.maxPlayers) {
      this.sendPeer(id, 'room:error', 'La stanza è al completo.');
      const p = this.peers.get(id);
      if (p) {
        this.peers.delete(id);
        p.pc.close();
      }
      this.relayPeers.delete(id);
      return;
    }

    const team = pickBalancedTeam(this.room.players);
    const player: LobbyPlayer = {
      id,
      name: String(payload?.playerName || 'Pilota').slice(0, 18),
      team,
      ready: true,
      isHost: false,
      customization:
        payload?.customization ||
        (team === 'blue'
          ? { ...DEFAULT_CUSTOMIZATION_BLUE }
          : { ...DEFAULT_CUSTOMIZATION_ORANGE }),
    };

    this.room.players.push(player);
    this.room.playerCount = this.room.players.length;
    this.sendPeer(id, 'room:joined', this.room);

    if (this.room.inProgress && this.simulation) {
      this.simulation.addOrReplacePlayer({
        id: player.id,
        name: player.name,
        team: player.team,
        customization: player.customization,
      });
      this.sendPeer(id, 'match:started', this.simulation.state);
    }

    this.update();
  }

  private clearJoinTimers() {
    if (this.joinTimeout) {
      clearTimeout(this.joinTimeout);
      this.joinTimeout = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.relayFallbackTimer) {
      clearTimeout(this.relayFallbackTimer);
      this.relayFallbackTimer = undefined;
    }
  }

  private onPeerMessage(id: string, msg: Message) {
    if (this.hostId !== this.id) {
      if (this.hostId && id !== this.hostId) return;
      if (msg.event === 'room:joined') {
        this.clearJoinTimers();
        this.pendingJoin = null;
        this.room = msg.payload;
        if (this.room?.hostId) {
          this.hostId = this.room.hostId;
        }
      }
      if (msg.event === 'room:error') {
        this.leave();
      }
      if (msg.event === 'room:updated') {
        this.room = msg.payload;
      }
      this.fire(msg.event, msg.payload);
      return;
    }
    if (!this.room) return;
    if (msg.event === 'join') {
      this.handleJoin(id, msg.payload);
      return;
    }
    if (!this.room.players.some((p) => p.id === id)) return;
    this.command(id, msg.event, msg.payload);
  }

  private command(id: string, event: string, data?: any) {
    const room = this.room;
    if (!room || this.hostId !== this.id) return;
    const player = room.players.find((p) => p.id === id);
    if (!player) return;
    if (event === 'player:input') {
      this.simulation?.setInput(id, data as PlayerInput);
      return;
    }
    if (event === 'room:leave') {
      if (id === this.id) this.leave();
      else this.peerLeft(id);
      return;
    }
    if (event === 'room:team' && (data?.team === 'blue' || data?.team === 'orange')) {
      player.team = data.team;
    }
    if (event === 'room:customize' && data?.customization) {
      player.customization = data.customization;
    }
    if (event === 'room:bots' && id === this.id) room.fillBots = !!data?.fillBots;
    if (event === 'room:arena' && id === this.id) room.arenaId = data?.arenaId;
    if ((event === 'match:start' || event === 'match:rematch') && id === this.id) {
      this.startMatch();
      return;
    }
    if (event === 'chat:send') {
      const text = String(data?.text || '').trim().slice(0, 64);
      if (text) {
        this.broadcast('chat:message', {
          id: crypto.randomUUID(),
          playerName: player.name,
          team: player.team,
          text,
          timestamp: Date.now(),
        });
      }
      return;
    }
    this.update();
  }

  private startMatch() {
    if (!this.room) return;
    if (this.timer) clearInterval(this.timer);
    const seeds: PlayerSeed[] = this.room.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      customization: p.customization,
    }));
    if (this.room.fillBots && this.room.mode !== 'freeplay') {
      for (const team of ['blue', 'orange'] as const) {
        const missing = Math.max(
          0,
          this.room.maxPlayers / 2 - seeds.filter((s) => s.team === team).length,
        );
        for (let i = 0; i < missing; i++) {
          seeds.push({
            id: `bot-${team}-${i}`,
            name: `Bot ${i + 1}`,
            team,
            isBot: true,
            customization:
              team === 'blue' ? DEFAULT_CUSTOMIZATION_BLUE : DEFAULT_CUSTOMIZATION_ORANGE,
          });
        }
      }
    }
    this.simulation = new HostSimulation(this.room.mode, this.room.arenaId, seeds);
    this.room.inProgress = true;
    this.broadcast('match:started', this.simulation.state);
    this.update();
    let last = performance.now();
    let ticks = 0;
    this.timer = setInterval(() => {
      if (!this.simulation) return;
      const now = performance.now();
      const events = this.simulation.step((now - last) / 1000);
      last = now;
      if (events.length) this.broadcast('game:events', events);
      if (++ticks % 3 === 0) this.broadcast('game:state', this.simulation.state);
    }, 1000 / 60);
  }

  emit(event: string, data?: any) {
    if (event === 'rooms:list') {
      this.found.clear();
      this.fire('rooms:update', []);
      if (this.connected) {
        this.sendSignal('discover');
        this.announce();
      }
      return this;
    }
    if (event === 'room:create' || event === 'matchmaking:quick') {
      this.leave();
      const code = generateRoomCode();
      const mode = data?.mode || '1v1';
      const maxPlayers = mode === '3v3' ? 6 : mode === '2v2' ? 4 : 2;
      const player: LobbyPlayer = {
        id: this.id,
        name: String(data?.playerName || 'Pilota').slice(0, 18),
        team: 'blue',
        ready: true,
        isHost: true,
        customization: data?.customization || DEFAULT_CUSTOMIZATION_BLUE,
      };
      this.hostId = this.id;
      this.room = {
        code,
        name: String(data?.roomName || 'Partita rapida').slice(0, 30),
        mode,
        arenaId: data?.arenaId || 'dfh_night',
        fillBots: data?.fillBots !== false,
        playerCount: 1,
        maxPlayers,
        inProgress: false,
        hostId: this.id,
        players: [player],
      };
      this.openRoomChannel(code);
      this.fire('room:joined', this.room);
      this.announce();
      if (event === 'matchmaking:quick') this.startMatch();
      return this;
    }
    if (event === 'room:join') {
      const code = normalizeRoomCodeInput(data?.code || '');
      if (!code) {
        this.fire('room:error', 'Inserisci un codice stanza valido.');
        return this;
      }
      if (!this.connected) {
        this.queuedJoin = { ...data, code };
        return this;
      }
      this.leave();
      this.pendingJoin = { ...data, code };
      this.sendSignal('request', { code });

      // Retry discovery/request once in case the initial broadcast was missed
      this.retryTimer = setTimeout(() => {
        if (this.pendingJoin && !this.hostId && !this.usingRelay) {
          this.sendSignal('request', { code });
        }
      }, 1400);

      // Fall back to Supabase room relay if direct WebRTC P2P does not open promptly
      this.relayFallbackTimer = setTimeout(() => {
        if (this.pendingJoin && !this.usingRelay) {
          this.activateRelayFallback(code);
        }
      }, 3800);

      this.joinTimeout = setTimeout(() => {
        if (this.pendingJoin) {
          this.leave();
          this.fire(
            'room:error',
            'Stanza non trovata o host non raggiungibile. Verifica il codice e che la stanza sia attiva.',
          );
        }
      }, 15000);
      return this;
    }
    if (this.hostId === this.id) {
      this.command(this.id, event, data);
    } else if (this.hostId || this.usingRelay) {
      this.sendPeer(this.hostId, event, data);
      if (event === 'room:leave') this.leave();
    }
    return this;
  }

  private leave() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clearJoinTimers();
    this.simulation = null;
    this.room = null;
    this.pendingJoin = null;
    this.hostId = '';
    this.usingRelay = false;
    this.relayReady = false;
    this.relayPeers.clear();
    this.earlyCandidates.clear();
    if (this.roomChannel) {
      const ch = this.roomChannel;
      this.roomChannel = null;
      void this.supabase.removeChannel(ch);
    }
    const peers = [...this.peers.values()];
    this.peers.clear();
    peers.forEach((p) => p.pc.close());
  }

  disconnect() {
    this.closed = true;
    this.queuedJoin = null;
    this.leave();
    this.connected = false;
    void this.supabase.removeChannel(this.signal);
  }
}

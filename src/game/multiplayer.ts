import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { HostSimulation } from '../shared/hostSimulation';
import { FixedStepClock, InputRateLimiter, relayRates } from '../shared/networkFlow';
import {
  packCompactSnapshot,
  unpackCompactSnapshot,
  type CompactGameStateWire,
  type RosterEntry,
} from '../shared/netSnapshot';
import type {
  CarCustomization,
  GameStateSnapshot,
  LobbyPlayer,
  PlayerInput,
  RoomDetail,
  RoomSummary,
} from '../shared/types';
import {
  DEFAULT_CUSTOMIZATION_BLUE,
  DEFAULT_CUSTOMIZATION_ORANGE,
} from '../shared/types';
import { skipGoalReplay, type PlayerSeed } from '../shared/physics';
import {
  canAcceptRoomRequest,
  findStalePlayerIds,
  generateRoomCode,
  normalizeRoomCodeInput,
  PEER_HEARTBEAT_TIMEOUT_MS,
  pickBalancedTeam,
} from '../shared/roomHelpers';

type Message = { event: string; payload?: any };
type Signal = { from: string; to?: string; kind: string; data?: any };
type Peer = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  stateChannel?: RTCDataChannel;
  candidates: RTCIceCandidateInit[];
};

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
  get isHost() { return this.hostId === this.id; }
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
  private inputRelays = new Map<string, RealtimeChannel>();
  private inputLimiter = new InputRateLimiter();
  private lastRelayImpactAt = -Infinity;
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
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private pendingJoin: any = null;
  private pendingProfile: { playerName: string; customization?: CarCustomization } | null = null;
  private queuedJoin: any = null;
  private closed = false;
  private joinTimeout?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private relayFallbackTimer?: ReturnType<typeof setTimeout>;
  private stateSeq = 0;
  private inputSeq = 0;
  private lastRecvStateSeq = 0;
  private lastPeerInputSeq = new Map<string, number>();
  private lastPeerSeen = new Map<string, number>();
  private lastHostPacketAt = 0;
  private rttMs: number | null = null;
  private wireTemplate: GameStateSnapshot | null = null;

  private readonly handlePageHide = () => {
    if (this.room && this.hostId && this.hostId !== this.id) {
      this.sendSignal('leave', { code: this.room.code }, this.hostId);
    }
  };

  constructor() {
    this.signal = this.supabase.channel('rocket-mink:signal:v1', {
      config: { broadcast: { self: false } },
    });
    this.signal.on('broadcast', { event: 'signal' }, ({ payload }) => {
      void this.onSignal(payload as Signal);
    });
    this.signal.subscribe((status) => this.onSignalStatus(status));
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handlePageHide);
    }
  }

  on(event: string, fn: (value?: any) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  getNetworkStats() {
    return { transport: this.isHost ? 'host' : this.usingRelay ? 'relay' : 'p2p', rttMs: this.rttMs } as const;
  }

  private onSignalStatus(status: string) {
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
      // Discovery is independent of the current match. Its retry must never kick a player.
      if (this.room) this.fire('signaling:status', 'reconnecting');
      else this.fire(wasConnected ? 'disconnect' : 'connect_error');
    }
  }

  private fire(event: string, value?: any) {
    this.handlers.get(event)?.forEach((fn) => fn(value));
  }

  private sendSignal(kind: string, data?: any, to?: string) {
    if (!this.connected || this.signal.state !== 'joined' || !this.supabase.realtime.isConnected()) return;
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
    if (!this.roomChannel || !this.relayReady || this.roomChannel.state !== 'joined' || !this.supabase.realtime.isConnected()) return;
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
      if (event === 'game:events' && Array.isArray(payload)) {
        const now = performance.now();
        const sendImpacts = now - this.lastRelayImpactAt >= 300;
        const relayEvents = payload.filter((item) => sendImpacts || (item.type !== 'ball_hit' && item.type !== 'wall_hit'));
        if (sendImpacts && relayEvents.length) this.lastRelayImpactAt = now;
        if (relayEvents.length) this.sendRoomRelay(event, relayEvents);
      } else {
        this.sendRoomRelay(event, payload);
      }
    }
  }

  private sendPeer(id: string, event: string, payload?: any, unreliable = false) {
    if (this.relayPeers.has(id) || (this.usingRelay && id === this.hostId)) {
      if (event === 'player:input' || event === 'ping' || event === 'pong') {
        const channel = this.inputRelays.get(this.isHost ? id : this.id);
        if (channel?.state === 'joined' && this.supabase.realtime.isConnected()) {
          void channel.send({ type: 'broadcast', event: 'peer', payload: { from: this.id, to: id, event, data: payload } });
        }
        return;
      }
      this.sendRoomRelay(event, payload, id);
      return;
    }
    const peer = this.peers.get(id);
    if (!peer) return;
    // Never put disposable state/input behind reliable retransmissions.
    const ch = unreliable ? peer.stateChannel : peer.channel;
    if (ch?.readyState === 'open') {
      if (unreliable && ch.bufferedAmount > 2048) return;
      ch.send(JSON.stringify({ event, payload }));
    }
  }

  private openRoomChannel(code: string, onSubscribed?: () => void) {
    if (this.hostId !== this.id) this.openInputRelay(this.id, code);
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
        if (payload.event === 'join' || payload.event === 'relay:attach') {
          this.relayPeers.add(payload.from);
          this.openInputRelay(payload.from, code);
          this.lastPeerSeen.set(payload.from, performance.now());
          // Keep ICE negotiation alive so a late direct connection can replace the relay.
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
        if (this.room && this.usingRelay && !this.isHost) {
          this.sendRoomRelay('relay:attach', { ...this.pendingProfile, resuming: true }, this.hostId);
        }
      } else {
        this.relayReady = false;
      }
    });
    this.roomChannel = channel;
  }

  private openInputRelay(playerId: string, code: string) {
    if (this.inputRelays.has(playerId)) return;
    const channel = this.supabase.channel(`rocket-mink:input:${code}:${playerId}`, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'peer' }, ({ payload }) => {
      if (!this.room || payload?.to !== this.id) return;
      if (this.isHost) {
        if (!this.relayPeers.has(playerId) || payload.from !== playerId) return;
        this.onPeerMessage(playerId, { event: payload.event, payload: payload.data });
      } else if (playerId === this.id && payload.from === this.hostId) {
        this.onPeerMessage(this.hostId, { event: payload.event, payload: payload.data });
      }
    });
    this.inputRelays.set(playerId, channel);
    channel.subscribe();
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
    const joinData = this.pendingJoin;
    this.openRoomChannel(code, () => {
      if (this.pendingJoin && this.usingRelay) {
        this.sendRoomRelay('join', joinData, this.hostId || undefined);
      }
    });
  }

  private switchToRelayMidMatch(code: string) {
    if (this.closed || this.usingRelay || !this.room || this.hostId === this.id) return;
    this.usingRelay = true;
    this.openRoomChannel(code);
  }

  private sweepStalePeers(timeoutMs = PEER_HEARTBEAT_TIMEOUT_MS) {
    if (!this.room || this.hostId !== this.id) return;
    const staleIds = findStalePlayerIds(
      this.room.players,
      this.lastPeerSeen,
      performance.now(),
      timeoutMs,
    );
    for (const staleId of staleIds) {
      this.peerLeft(staleId);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.hostId === this.id) {
      for (const p of this.room?.players ?? []) {
        if (!p.isHost) this.lastPeerSeen.set(p.id, performance.now());
      }
    } else {
      this.lastHostPacketAt = performance.now();
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.closed || !this.room) return;
      const now = performance.now();
      if (this.hostId === this.id) {
        this.sweepStalePeers(PEER_HEARTBEAT_TIMEOUT_MS);
        return;
      }

      if (this.hostId) {
        this.sendPeer(this.hostId, 'ping', { t: performance.now() });
        const silentMs = now - this.lastHostPacketAt;
        if (silentMs > 2500 && !this.usingRelay) {
          this.switchToRelayMidMatch(this.room.code);
        } else if (silentMs > 4500 && this.usingRelay && this.relayReady) {
          this.sendRoomRelay('relay:attach', { ...this.pendingProfile, resuming: true }, this.hostId);
        } else if (silentMs > 12500) {
          this.peerLeft(this.hostId);
        }
      }
    }, 1500);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
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
    peer.pc.ondatachannel = (e) => {
      if (e.channel.label === 'state') {
        this.bindStateChannel(peer, e.channel, id);
      } else {
        this.bindChannel(id, peer, e.channel);
      }
    };
    peer.pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      const state = peer.pc.connectionState;
      if (state === 'disconnected' && this.hostId !== this.id && this.room && !this.usingRelay) {
        setTimeout(() => {
          if (
            this.peers.get(id) === peer &&
            peer.pc.connectionState === 'disconnected' &&
            !this.usingRelay &&
            this.room
          ) {
            this.switchToRelayMidMatch(this.room.code);
          }
        }, 1200);
        return;
      }
      if (state === 'failed' || state === 'closed') {
        this.handleDirectFailure(id, peer);
      }
    };
    return peer;
  }

  private bindStateChannel(peer: Peer, channel: RTCDataChannel, id: string) {
    peer.stateChannel = channel;
    channel.onopen = () => this.activateDirectChannel(id, peer);
    channel.onclose = () => this.handleDirectFailure(id, peer);
    channel.onmessage = (e) => {
      try {
        this.onPeerMessage(id, JSON.parse(e.data) as Message, true);
      } catch {
        // Ignore malformed unreliable frames.
      }
    };
  }

  private bindChannel(id: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.onopen = () => {
      this.activateDirectChannel(id, peer);
    };
    channel.onmessage = (e) => {
      try {
        this.onPeerMessage(id, JSON.parse(e.data) as Message, true);
      } catch {
        // Ignore malformed messages.
      }
    };
    channel.onclose = () => {
      this.handleDirectFailure(id, peer);
    };
  }

  private handleDirectFailure(id: string, peer: Peer) {
    if (this.peers.get(id) !== peer) return;
    this.peers.delete(id);
    peer.pc.close();
    // A failed ICE attempt is not a failed room: relay membership and simulation survive.
    if (this.isHost || this.usingRelay) return;
    if (this.pendingJoin) this.activateRelayFallback(this.pendingJoin.code);
    else if (this.room) this.switchToRelayMidMatch(this.room.code);
  }

  private activateDirectChannel(id: string, peer: Peer) {
    if (peer.channel?.readyState !== 'open' || peer.stateChannel?.readyState !== 'open') return;
    if (this.hostId !== this.id) {
      peer.channel.send(JSON.stringify({ event: 'transport:p2p' }));
      if (this.pendingJoin) peer.channel.send(JSON.stringify({ event: 'join', payload: this.pendingJoin }));
    }
  }

  private peerLeft(id: string) {
    const wasWebRtc = this.peers.delete(id);
    const wasRelay = this.relayPeers.delete(id);
    const inputChannel = this.inputRelays.get(id);
    if (inputChannel) {
      this.inputRelays.delete(id);
      void this.supabase.removeChannel(inputChannel);
    }
    this.lastPeerInputSeq.delete(id);
    this.lastPeerSeen.delete(id);
    const inRoom =
      this.hostId === this.id && !!this.room && this.room.players.some((p) => p.id === id);
    if (!wasWebRtc && !wasRelay && !inRoom) return;

    if (this.hostId === this.id && this.room) {
      this.room.players = this.room.players.filter((p) => p.id !== id);
      this.simulation?.demoteToBot(id);
      if (this.room.inProgress && this.simulation) {
        this.broadcastRoster(this.simulation.state);
      }
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
        s.kind === 'leave' &&
        this.hostId === this.id &&
        this.room &&
        (!s.data?.code || s.data.code === this.room.code)
      ) {
        this.peerLeft(s.from);
        return;
      }
      if (
        s.kind === 'request' &&
        this.hostId === this.id &&
        this.room &&
        this.room.code === s.data?.code
      ) {
        this.sweepStalePeers(PEER_HEARTBEAT_TIMEOUT_MS);
        if (!canAcceptRoomRequest(this.room.players, this.room.maxPlayers, s.from, [])) {
          this.sweepStalePeers(3500);
        }
        if (!canAcceptRoomRequest(this.room.players, this.room.maxPlayers, s.from, [])) {
          this.sendSignal('reject', 'La stanza è al completo.', s.from);
          return;
        }
        this.lastPeerSeen.set(s.from, performance.now());
        const peer = this.newPeer(s.from);
        this.bindChannel(s.from, peer, peer.pc.createDataChannel('game'));
        this.bindStateChannel(
          peer,
          peer.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }),
          s.from,
        );
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
    this.sweepStalePeers(PEER_HEARTBEAT_TIMEOUT_MS);
    if (!canAcceptRoomRequest(this.room.players, this.room.maxPlayers, id, [])) {
      this.sweepStalePeers(3500);
    }

    const existing = this.room.players.find((p) => p.id === id);
    if (existing) {
      this.lastPeerSeen.set(id, performance.now());
      if (payload?.playerName) {
        existing.name = String(payload.playerName).slice(0, 18);
      }
      if (payload?.customization) {
        existing.customization = payload.customization;
      }
      this.sendPeer(id, 'room:joined', this.room);
      if (this.room.inProgress && this.simulation) {
        const car = this.simulation.state.cars.find((c) => c.id === id);
        if (car) {
          car.name = existing.name;
          car.isBot = false;
          car.customization = existing.customization;
        }
        this.broadcastRoster(this.simulation.state);
        this.sendPeer(id, payload?.resuming ? 'game:resync' : 'match:started', this.simulation.state);
      }
      return;
    }
    if (!canAcceptRoomRequest(this.room.players, this.room.maxPlayers, id, [])) {
      this.sendPeer(id, 'room:error', 'La stanza è al completo.');
      const p = this.peers.get(id);
      if (p) {
        this.peers.delete(id);
        p.pc.close();
      }
      this.relayPeers.delete(id);
      return;
    }

    this.lastPeerSeen.set(id, performance.now());
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
      this.broadcastRoster(this.simulation.state);
      this.sendPeer(id, 'match:started', this.simulation.state);
    }

    this.update();
  }

  private broadcastRoster(state: GameStateSnapshot) {
    const roster: RosterEntry[] = state.cars.map((c) => ({
      id: c.id,
      name: c.name,
      team: c.team,
      isBot: c.isBot,
      customization: c.customization,
    }));
    this.broadcast('game:roster', roster);
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

  private onPeerMessage(id: string, msg: Message, direct = false) {
    // Route changes require a complete two-channel handshake, not a stray late packet.
    if (direct && msg.event === 'transport:p2p' && this.isHost) {
      const peer = this.peers.get(id);
      if (peer?.channel?.readyState === 'open' && peer.stateChannel?.readyState === 'open') {
        this.relayPeers.delete(id);
        peer.channel.send(JSON.stringify({ event: 'transport:ready' }));
      }
      return;
    }
    if (direct && msg.event === 'transport:ready' && id === this.hostId) {
      const peer = this.peers.get(id);
      if (peer?.channel?.readyState === 'open' && peer.stateChannel?.readyState === 'open') this.usingRelay = false;
      return;
    }
    if (this.hostId !== this.id) {
      if (this.hostId && id !== this.hostId) return;
      this.lastHostPacketAt = performance.now();
      if (msg.event === 'pong') {
        if (typeof msg.payload?.t === 'number') this.rttMs = Math.max(0, performance.now() - msg.payload.t);
        return;
      }
      if (msg.event === 'game:resync') {
        this.wireTemplate = structuredClone(msg.payload);
        this.fire('game:state', msg.payload);
        return;
      }
      if (msg.event === 'room:joined') {
        this.clearJoinTimers();
        this.pendingJoin = null;
        this.room = msg.payload;
        if (this.room?.hostId) {
          this.hostId = this.room.hostId;
        }
        this.startHeartbeat();
      }
      if (msg.event === 'room:error') {
        this.leave();
      }
      if (msg.event === 'room:updated') {
        this.room = msg.payload;
      }
      if (msg.event === 'match:started') {
        this.lastRecvStateSeq = 0;
        this.wireTemplate = structuredClone(msg.payload);
      }
      if (msg.event === 'game:roster' && this.wireTemplate && Array.isArray(msg.payload)) {
        const entries = msg.payload as RosterEntry[];
        this.wireTemplate.cars = entries.map((entry, idx) => {
          const existing = this.wireTemplate!.cars[idx];
          return {
            ...(existing || this.wireTemplate!.cars[0]),
            id: entry.id,
            name: entry.name,
            team: entry.team,
            isBot: entry.isBot,
            customization: entry.customization,
          };
        });
        return;
      }
      if (msg.event === 'game:state:c') {
        const wire = msg.payload as CompactGameStateWire;
        if (!wire || !this.wireTemplate || wire.seq <= this.lastRecvStateSeq) return;
        this.lastRecvStateSeq = wire.seq;
        const unpacked = unpackCompactSnapshot(wire, this.wireTemplate);
        this.fire('game:state', unpacked);
        return;
      }
      this.fire(msg.event, msg.payload);
      return;
    }
    if (!this.room) return;
    this.lastPeerSeen.set(id, performance.now());
    if (msg.event === 'ping') {
      this.sendPeer(id, 'pong', { t: msg.payload?.t ?? Date.now() }, true);
      return;
    }
    if (msg.event === 'pong') return;
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
      if (data && typeof data.seq === 'number' && data.input) {
        const prevSeq = this.lastPeerInputSeq.get(id) ?? 0;
        if (data.seq <= prevSeq) return;
        this.lastPeerInputSeq.set(id, data.seq);
        this.simulation?.setInput(id, data.input as PlayerInput, data.time);
      } else {
        this.simulation?.setInput(id, (data?.input ?? data) as PlayerInput, data?.time);
      }
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
    if (event === 'replay:skip' && id === this.id && this.simulation) {
      const events = skipGoalReplay(this.simulation.state);
      if (events.length) this.broadcast('game:events', events);
      this.fire('game:state', structuredClone(this.simulation.state));
      const wire = packCompactSnapshot(this.simulation.state, ++this.stateSeq);
      const serialized = JSON.stringify({ event: 'game:state:c', payload: wire });
      for (const peer of this.peers.values()) {
        const ch = peer.stateChannel?.readyState === 'open' ? peer.stateChannel : peer.channel;
        if (ch?.readyState === 'open') ch.send(serialized);
      }
      if (this.relayPeers.size > 0) this.sendRoomRelay('game:state:c', wire);
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
    this.stateSeq = 0;
    this.broadcast('match:started', this.simulation.state);
    this.update();
    let last = performance.now();
    const clock = new FixedStepClock();
    let ticks = 0;
    let lastWebRtcTick = 0;
    let lastRelayTick = 0;
    const FIXED_DT = 1 / 60;
    this.timer = setInterval(() => {
      if (!this.simulation) return;
      const now = performance.now();
      const frameDt = Math.min(Math.max((now - last) / 1000, 0), 0.25);
      last = now;
      const steps = clock.advance(frameDt);
      for (let step = 0; step < steps; step++) {
        const events = this.simulation.step(FIXED_DT);
        if (events.length) this.broadcast('game:events', events);
        ticks += 1;
      }
      if (steps === 0) return;

      const sendWebRtc = ticks - lastWebRtcTick >= 2; // 30Hz over unreliable WebRTC DataChannel
      const sendRelay = ticks - lastRelayTick >= relayRates(this.room?.players.length ?? 2).stateIntervalTicks && this.relayPeers.size > 0;

      if (sendWebRtc) {
        lastWebRtcTick = ticks;
        this.fire('game:state', structuredClone(this.simulation.state));
      }
      if (sendRelay) {
        lastRelayTick = ticks;
      }
      if ((sendWebRtc && this.peers.size > 0) || sendRelay) {
        const wire = packCompactSnapshot(this.simulation.state, ++this.stateSeq);
        if (sendWebRtc && this.peers.size > 0) {
          const serialized = JSON.stringify({ event: 'game:state:c', payload: wire });
          for (const peer of this.peers.values()) {
            const ch = peer.stateChannel;
            if (ch?.readyState === 'open' && ch.bufferedAmount < 2048) {
              ch.send(serialized);
            }
          }
        }
        if (sendRelay) {
          this.sendRoomRelay('game:state:c', wire);
        }
      }
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
      this.pendingProfile = {
        playerName: String(data?.playerName || 'Pilota').slice(0, 18),
        customization: data?.customization || DEFAULT_CUSTOMIZATION_BLUE,
      };
      this.openRoomChannel(code);
      this.startHeartbeat();
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
      this.pendingProfile = {
        playerName: String(data?.playerName || 'Pilota').slice(0, 18),
        customization: data?.customization,
      };
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
    if (event === 'room:customize' && data?.customization && this.pendingProfile) {
      this.pendingProfile.customization = data.customization;
    }
    if (event === 'room:leave') {
      if (this.hostId === this.id) {
        this.leave();
      } else {
        if (this.room && this.hostId) {
          this.sendSignal('leave', { code: this.room.code }, this.hostId);
        }
        if (this.hostId || this.usingRelay) {
          this.sendPeer(this.hostId, 'room:leave', data);
        }
        this.leave();
      }
      return this;
    }
    if (this.hostId === this.id) {
      this.command(this.id, event, data);
    } else if (this.hostId || this.usingRelay) {
      if (event === 'player:input') {
        if (!this.inputLimiter.accept(data?.input ?? data, performance.now(), this.usingRelay, relayRates(this.room?.players.length ?? 2).inputIntervalMs)) return this;
        this.sendPeer(
          this.hostId,
          'player:input',
          { seq: ++this.inputSeq, input: data?.input ?? data, time: data?.time },
          true,
        );
      } else {
        this.sendPeer(this.hostId, event, data);
      }
    }
    return this;
  }

  private leave() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.stopHeartbeat();
    this.clearJoinTimers();
    this.simulation = null;
    this.room = null;
    this.pendingJoin = null;
    this.wireTemplate = null;
    this.inputLimiter = new InputRateLimiter();
    this.rttMs = null;
    for (const channel of this.inputRelays.values()) void this.supabase.removeChannel(channel);
    this.inputRelays.clear();
    this.stateSeq = 0;
    this.inputSeq = 0;
    this.lastRecvStateSeq = 0;
    this.lastPeerInputSeq.clear();
    this.lastPeerSeen.clear();
    this.lastHostPacketAt = 0;
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handlePageHide);
    }
    this.leave();
    this.connected = false;
    void this.supabase.removeChannel(this.signal);
  }
}

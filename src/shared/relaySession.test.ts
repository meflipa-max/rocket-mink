import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerClient } from '../game/multiplayer';
import { HostSimulation } from './hostSimulation';
import { InputRateLimiter } from './networkFlow';
import { DEFAULT_CUSTOMIZATION_BLUE } from './types';
import { NEUTRAL_INPUT } from './physics';

test('a relayed match resumes after discovery and late ICE failures without restarting or losing input delivery', async () => {
  const channels = new Map<string, Set<any>>();
  const deliveries: Array<{ topic: string; recipients: number }> = [];
  function service() {
    const api = {
      realtime: { isConnected: () => true },
      removeChannel(channel: any) { channels.get(channel.topic)?.delete(channel); return Promise.resolve('ok'); },
      channel(topic: string) {
        const handlers: Array<{ event: string; callback: (value: any) => void }> = [];
        let subscribed: ((status: string) => void) | undefined;
        const channel: any = {
          topic, state: 'joining',
          on(_type: string, filter: { event: string }, callback: (value: any) => void) { handlers.push({ event: filter.event, callback }); return channel; },
          subscribe(callback?: (status: string) => void) {
            if (callback) subscribed = callback;
            queueMicrotask(() => { channel.state = 'joined'; subscribed?.('SUBSCRIBED'); });
            return channel;
          },
          send(message: any) {
            const recipients = [...(channels.get(topic) ?? [])].filter((target) => target !== channel && target.state === 'joined');
            deliveries.push({ topic, recipients: recipients.length });
            for (const target of recipients) queueMicrotask(() => target.receive(message));
            return Promise.resolve('ok');
          },
          receive(message: any) { handlers.filter((handler) => handler.event === message.event).forEach((handler) => handler.callback({ payload: structuredClone(message.payload) })); },
        };
        if (!channels.has(topic)) channels.set(topic, new Set());
        channels.get(topic)!.add(channel);
        return channel;
      },
    };
    return api;
  }
  const room = { code: 'ABCDEF', name: 'Test', mode: '1v1', arenaId: 'dfh_night', maxPlayers: 2, playerCount: 2, hostId: 'host', inProgress: true, fillBots: false,
    players: ['host', 'guest'].map((id) => ({ id, name: id, team: id === 'host' ? 'blue' : 'orange', ready: true, isHost: id === 'host', customization: DEFAULT_CUSTOMIZATION_BLUE })) };
  const fired = new Map<string, string[]>();
  function client(id: string): any {
    fired.set(id, []);
    return Object.assign(Object.create(MultiplayerClient.prototype), {
      id, hostId: 'host', room: structuredClone(room), connected: true, closed: false,
      supabase: service(), inputRelays: new Map(), relayPeers: new Set(), peers: new Map(),
      handlers: new Map(), lastPeerSeen: new Map(), lastPeerInputSeq: new Map(), inputLimiter: new InputRateLimiter(),
      stateSeq: 0, inputSeq: 0, lastRecvStateSeq: 0, usingRelay: id !== 'host', relayReady: false,
      pendingProfile: { playerName: id }, fire(event: string) { fired.get(id)!.push(event); },
      startHeartbeat() {}, announce() {},
    });
  }
  const host = client('host');
  host.simulation = new HostSimulation('1v1', 'dfh_night', [{ id: 'host', name: 'Host', team: 'blue' }, { id: 'guest', name: 'Guest', team: 'orange' }]);
  host.simulation.state.phase = 'active';
  const guest = client('guest');
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
  host.openRoomChannel('ABCDEF');
  guest.openRoomChannel('ABCDEF');
  await drain();
  assert.ok(host.relayPeers.has('guest'));
  assert.ok(fired.get('guest')!.includes('game:state'), 'Room resume receives a full state');
  assert.equal(fired.get('guest')!.includes('match:started'), false, 'Transport recovery must not reset prediction time');

  guest.sendPeer('host', 'player:input', { seq: 1, input: { ...NEUTRAL_INPUT, throttle: 1 }, time: 0 }, true);
  await drain();
  host.simulation.step(1 / 60);
  assert.ok(Math.hypot(host.simulation.state.cars[1].vel.x, host.simulation.state.cars[1].vel.z) > 0);
  assert.ok(deliveries.filter((entry) => entry.topic.includes(':input:')).every((entry) => entry.recipients === 1));

  guest.onSignalStatus('CHANNEL_ERROR');
  host.onSignalStatus('TIMED_OUT');
  const peer = { pc: { close() {} } };
  guest.peers.set('host', peer);
  guest.handleDirectFailure('host', peer);
  guest.roomChannel.subscribe();
  guest.onSignalStatus('SUBSCRIBED');
  host.onSignalStatus('SUBSCRIBED');
  await drain();
  guest.sendPeer('host', 'ping', { t: performance.now() });
  await drain();
  assert.ok(guest.getNetworkStats().rttMs !== null);
  assert.equal(guest.room.code, 'ABCDEF');
  assert.equal(host.room.players.length, 2);
  assert.equal(fired.get('guest')!.includes('disconnect'), false);
  assert.equal(fired.get('host')!.includes('disconnect'), false);
  assert.equal(fired.get('guest')!.includes('match:started'), false);
});
